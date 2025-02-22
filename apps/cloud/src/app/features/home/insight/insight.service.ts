import { computed, inject, Injectable, signal } from '@angular/core'
import { CopilotChatMessageRoleEnum } from '@metad/copilot'
import { NgmDSCoreService } from '@metad/ocap-angular/core'
import { WasmAgentService } from '@metad/ocap-angular/wasm-agent'
import {
  ChartAnnotation,
  ChartDimension,
  ChartMeasure,
  Cube,
  C_MEASURES,
  DataSettings,
  EntityType,
  getEntityDimensions,
  isEntityType
} from '@metad/ocap-core'
import { UntilDestroy } from '@ngneat/until-destroy'
import { convertNewSemanticModelResult, ModelsService, NgmSemanticModel } from '@metad/cloud/state'
import JSON5 from 'json5'
import { uniq, upperFirst } from 'lodash-es'
import { BehaviorSubject, combineLatest, filter, firstValueFrom, map, switchMap } from 'rxjs'
import { calcEntityTypePrompt, CopilotService, ISemanticModel, registerModel } from '../../../@core'
import { getSemanticModelKey } from '@metad/story/core'
import { nonNullable } from '@metad/core'
import { toSignal } from '@angular/core/rxjs-interop'


@UntilDestroy()
@Injectable()
export class InsightService {
  private modelsService = inject(ModelsService)
  private copilotService = inject(CopilotService)
  private dsCoreService = inject(NgmDSCoreService)
  private wasmAgent = inject(WasmAgentService)

  get model(): NgmSemanticModel {
    return this.model$.value
  }
  set model(value) {
    this.model$.next(value)
  }
  private model$ = new BehaviorSubject(null)

  modelSignal = toSignal(this.model$)
  // cube: Cube
  cube = signal<Cube>(null)
  private _suggestedPrompts = signal<Record<string, string[]>>({})

  suggestedPrompts = computed(() => {
    return this._suggestedPrompts()[(getSemanticModelKey(this.modelSignal()) + (this.cube()?.name ?? ''))]
  })
  suggesting = false
  error = ''
  answers = [
  ]

  demoModelCubes = [
    {
      name: 'Visit',
      caption: '访问',
      dimensions: [
        {
          name: '[Time]',
          caption: '日历',
          hierarchies: [
            {
              name: '[Time]',
              caption: '日历',
              levels: [
                {
                  name: '[Time].[Year]',
                  caption: '年'
                },
                {
                  name: '[Time].[Month]',
                  caption: '月'
                },
                {
                  name: '[Time].[Day]',
                  caption: '日'
                }
              ]
            }
          ]
        },
        {
          name: '[Product]',
          caption: '产品',
          hierarchies: [
            {
              name: '[Product]',
              caption: '产品',
              levels: [
                {
                  name: '[Product].[Category]',
                  caption: '类别'
                },
                {
                  name: '[Product].[Name]',
                  caption: '名称'
                }
              ]
            }
          ]
        }
      ],
      measures: [
        {
          name: 'visits',
          caption: '访问量'
        }
      ]
    }
  ]

  entityPromptLimit = 10
  public readonly copilotNotEnabled$ = this.copilotService.notEnabled$
  readonly models$ = this.modelsService.getMy()
  readonly hasCube$ = this.model$.pipe(map((model) => !!model?.schema?.cubes?.length))
  readonly cubes$ = this.model$.pipe(
    filter(nonNullable),
    switchMap((model) => this.dsCoreService.getDataSource(getSemanticModelKey(model))),
    switchMap((dataSource) => dataSource.discoverMDCubes())
  )

  async setModel(model: NgmSemanticModel) {
    model = convertNewSemanticModelResult(await firstValueFrom(this.modelsService.getById(model.id, ['indicators', 'createdBy', 'updatedBy', 'dataSource', 'dataSource.type',])))
    this.model = model
    if (!this._suggestedPrompts()[getSemanticModelKey(model)]) {
      this.registerModel(model)
      const prompts = await this.suggestPrompts()
      this._suggestedPrompts.set({...this._suggestedPrompts(), [getSemanticModelKey(model)]: prompts})
    }
  }

  async setCube(cube: Cube) {
    this.cube.set(cube)
    if (cube) {
      const prompts = await this.suggestPrompts()
      this._suggestedPrompts.set({...this._suggestedPrompts(), [getSemanticModelKey(this.model) + this.cube().name]: prompts})
    }
  }

  registerModel(model) {
    registerModel(model, this.dsCoreService, this.wasmAgent)
  }

  async preclassify(prompt: string, options?: { signal: AbortSignal }) {
    const choices = await this.copilotService.createChat(
      [
        {
          role: CopilotChatMessageRoleEnum.System,
          content: `请根据多维模型列表给出问题涉及到的 only one model name in json format
例如
多维模型列表： "sales_fact" 销售, "product" 产品, "warehouse" 仓库
问题：按产品类别统计销售额
回答： "sales_fact"`
        },
        {
          role: CopilotChatMessageRoleEnum.User,
          content: `多维模型列表： ${await this.getAllEntities()}
问题：${prompt}
回答： `
        }
      ],
      {
        ...(options ?? {}),
        request: {
          temperature: 0.2
        }
      }
    )

    try {
      const answer = JSON5.parse(choices[0].message.content)
      return answer
    } catch (err) {
      throw new Error(`Error parse: ${choices[0].message.content}`)
    }
  }

  async askCopilot(prompt: string, options?: { signal: AbortSignal }) {
    const dataSourceName = this.model.key
    try {
      const hasCube = await firstValueFrom(this.hasCube$)
      const classification = hasCube && this.cube() ? this.cube().name : await this.preclassify(prompt, options)
      const entityType = await this.getEntityType(classification)
      const cubes = await this.getAllCubes()
      const choices = await this.copilotService.createChat(
        [
          {
            role: CopilotChatMessageRoleEnum.System,
            content: `假设你是一名 BI 专家，请根据多维数据模型信息给出用户问题对应的图形的配置 in json format，不用解释。过滤条件为 slicers，slicers is optional, Order is optional。
${this.getChartTypePrompt()}
${this.getSlicersPrompt()}
${this.getDimensionPrompt()}
${this.getMeasurePrompt()}
${this.getDataSettingsPrompt()}
例如：
多维数据模型信息为：${JSON.stringify(this.demoModelCubes)}
问题：产品类别为 Bike 的访问量走势
回答：{
  "cube": "Visit",
  "chartType": {
    "type": "Line"
  },
  "dimension": {
    "dimension": "[Time]",
    "hierarchy": "[Time]",
    "level": "[Time].[Day]",
  },
  "measure": {
    "measure": "visits"
  },
  "slicers": [
    {
      "dimension": {
        "dimension": "[Product]",
        "hierarchy": "[Product]",
        "level": "[Product].[Category]"
      },
      "members": [
        {
          "value": "Bike"
        }
      ]
    }
  ]
}`
          },
          {
            role: CopilotChatMessageRoleEnum.User,
            content: `多维数据模型信息为：
  ${this.getEntityTypePrompt(entityType)}
  问题：${prompt}
  回答：`
          }
        ],
        {
          ...(options ?? {}),
          request: {
            temperature: 0.2 // 不要那么随意
          }
        }
      )

      try {
        const answer = JSON5.parse(choices[0].message.content)
        const { chartAnnotation, slicers, limit, chartOptions } = transformCopilotChart(answer)
        const answerMessage = {
          message: choices[0].message.content,
          dataSettings: {
            dataSource: dataSourceName,
            entitySet: answer.cube,
            chartAnnotation,
            presentationVariant: {
              maxItems: limit,
              groupBy: getEntityDimensions(entityType).map((property) => ({
                dimension: property.name,
                hierarchy: property.defaultHierarchy,
                level: null
              }))
            },
          } as DataSettings,
          slicers,
          chartOptions,
          isCube: cubes.find((item) => item.name === answer.cube)
        }

        return answerMessage
      } catch (err) {
        return {
          message: choices[0].message.content
        }
      }
    } catch(err: any) {
      this.error = err.message
      return {
        message: ''
      }
    }

  }

  async suggestPrompts(cube?: Cube) {
    this.suggesting = true
    try {
      let prompt = ''
      // 指定 Cube 或者随机 10 个 Cube 或表信息
      if (cube) {
        prompt = await this.getEntityTypePrompt(await this.getEntityType(cube.name))
      } else {
        prompt = await this.getRandomEntityTypes(10)
      }
      const choices = await this.copilotService.createChat(
        [
          {
            role: CopilotChatMessageRoleEnum.System,
            content: `假设你是一名 BI 专家，请根据多维数据模型信息给出用户应该提问的问题 in json format，不用解释。
  例如：
  多维数据模型信息为：${JSON.stringify(this.demoModelCubes)}
  回答：[
    "访问量走势, 线条平滑，线粗5",
    "按产品类别统计访问量, 显示图例",
    "2023年某产品的访问量走势",
  ]
  `
          },
          {
            role: CopilotChatMessageRoleEnum.User,
            content: `多维数据模型信息为：${prompt}\n回答：`
          }
        ],
      )
      const answer = JSON5.parse(choices[0].message.content)
      return answer
    } catch (err: any) {
      this.error = err.message
      return []
    } finally {
      this.suggesting = false
    }
  }

  getCubesPromptInfo(entityTypes: EntityType[]) {
    return entityTypes.map((cube) => this.getEntityTypePrompt(cube))
  }

  /**
   * 获取数据源的实体信息，多维数据集或者源表结构
   */
  async getRandomEntityTypes(total: number) {
    const dataSourceName = getSemanticModelKey(this.model)
    const dataSource = await firstValueFrom(this.dsCoreService.getDataSource(dataSourceName))
    if (this.model.schema?.cubes?.length) {
      const cubes = await firstValueFrom(dataSource.discoverMDCubes())
      const randomCubes = []
      //loop 10 times to select 10 items
      for (let i = 0; i < Math.min(cubes.length, total); i++) {
        let randomIndex = Math.floor(Math.random() * cubes.length) //generate random index
        let selectedItem = cubes[randomIndex] //get the randomly selected item
        randomCubes.push(selectedItem) //add the item to the array of random items
        cubes.splice(randomIndex, 1) //remove the selected item from the original array to prevent duplicates
      }

      const entityTypes = await firstValueFrom(
        combineLatest<Array<EntityType | Error>>(randomCubes.map((cube) => dataSource.selectEntityType(cube.name)))
      )
      return JSON.stringify(this.getCubesPromptInfo(entityTypes.filter(isEntityType)))
    } else {
      const tables = await firstValueFrom(dataSource.discoverDBTables())
      const randomTables = []
      //loop 10 times to select 10 items
      for (let i = 0; i < Math.min(tables.length, total); i++) {
        let randomIndex = Math.floor(Math.random() * tables.length) //generate random index
        let selectedItem = tables[randomIndex] //get the randomly selected item
        randomTables.push(selectedItem) //add the item to the array of random items
        tables.splice(randomIndex, 1) //remove the selected item from the original array to prevent duplicates
      }

      const entityTypes = await firstValueFrom(
        combineLatest<Array<EntityType | Error>>(randomTables.map((table) => dataSource.selectEntityType(table.name)))
      )

      return entityTypes
        .filter(isEntityType)
        .map(
          (entityType) =>
            `Table: ${entityType.name} caption: ${entityType.caption} columns: (${Object.keys(entityType.properties)
              .map(
                (name) =>
                  `${name} ${entityType.properties[name].dataType ?? ''} ${entityType.properties[name].caption ?? ''}`
              )
              .join(', ')})`
        )
        .join(', ')
    }
  }

  async getAllCubes() {
    const dataSourceName = getSemanticModelKey(this.model)
    const dataSource = await firstValueFrom(this.dsCoreService.getDataSource(dataSourceName))
    if (this.model.schema?.cubes?.length) {
      return await firstValueFrom(dataSource.discoverMDCubes())
    }
    return []
  }

  async getAllEntities() {
    const dataSourceName = getSemanticModelKey(this.model)
    const dataSource = await firstValueFrom(this.dsCoreService.getDataSource(dataSourceName))

    const entities = []
    if (this.model.schema?.cubes?.length) {
      const cubes = await firstValueFrom(dataSource.discoverMDCubes())
      entities.push(cubes.map((cube) => `"${cube.name}" ${cube.caption ?? ''}`))
    } else {
      const tables = await firstValueFrom(dataSource.discoverDBTables())
      entities.push(tables.map((item) => `"${item.name}" ${item.caption ?? ''}`))
    }

    return uniq(entities).join(', ')
  }

  async getEntityType(name: string) {
    const dataSourceName = getSemanticModelKey(this.model)
    const dataSource = await firstValueFrom(this.dsCoreService.getDataSource(dataSourceName))
    const entityType = await firstValueFrom(dataSource.selectEntityType(name))
    if (isEntityType(entityType)) {
      return entityType
    }

    throw entityType
  }

  getChartTypePrompt() {
    return `chartType 属性类型定义("type" is required, others is optional)为：
${JSON.stringify([
  {"type": "Pie"}, {"type": "Pie", "variant": "Doughnut"}, {"type": "Pie", "variant": "Nightingale"},
  {"type": "Bar", "orient": "horizontal", "variant": "polar"}, {"type": "Bar", "orient": "vertical", "variant": "polar"},
  {"type": "Bar", "orient": "horizontal"},
  {"type": "Bar", "orient": "vertical"},
  {"type": "Bar"},
  {"type": "Line"}, {"type": "Line", "orient": "horizontal"}, {"type": "Line", "orient": "vertical"}, {"type": "Sankey"}, {"type": "Sankey", "orient": "horizontal"}, {"type": "Sankey", "orient": "vertical"}, {"type": "Treemap"}
])}`
  }

  getSlicersPrompt() {
    return `过滤器使用属性 slicers 类型定义为：
{
  "dimension": {
    "dimension": // required 维度
    "hierarchy": // 层次结构
    "level": // 层级
  },
  "members": [
    {
      "value": // required 成员唯一键
      "caption": //成员文本
    }
  ],
  "exclude": true | false // 是否排除 members 中的成员
}`
  }

  getDimensionPrompt() {
    return `The json schema for Dimension object is:
{
  "dimension": // required Dimension name
  "hierarchy": // Hierarchy name in the dimension
  "level": // level name
  "order": "DESC" | "ASC" // optional
  "role": "Stacked" | "Group" | "Trellis" // optional
}
    `
  }

  getMeasurePrompt() {
    return `The json schema for Measure object is:
{
  "dimension": "Measures", // Constant value for measure
  "measure": // required the name of measure
  "order": "DESC" | "ASC" // optional
  "chartOptions": { // chartOptions is ECharts options (in json format) for the Measure
    "seriesStyle": // ECharts series options (in json format) for the Measure
    "axis": // ECharts axis options (in json format) for the measure
    "dataZoom": // ECharts dataZoom options (in json format) for the measure
  }
}
    `
  }

  getDataSettingsPrompt() {
    return `The json schema for data settings is:
{
  "dimensions": [
    one or more Dimension object array
  ],
  "measures": [
    one or more Measure object array
  ],
  "limit": // Limit number of results
}    
`
  }

  getEntityTypePrompt(entityType: EntityType) {
    return calcEntityTypePrompt(entityType)
  }

}

export function transformCopilotChart(answer) {
  const chartAnnotation = {} as ChartAnnotation
  if (answer.chartType) {
    chartAnnotation.chartType = {
      ...answer.chartType,
      type: upperFirst(answer.chartType.type)
    }
  } else {
    chartAnnotation.chartType = {
      type: 'Bar',
    }
  }

  const dimensions = (answer.dimension ? [answer.dimension] : answer.dimensions) ?? []
  chartAnnotation.dimensions = dimensions.map((dimension) => (
    {
      ...dimension,
      zeroSuppression: true,
      chartOptions: {
        dataZoom: {
          type: 'inside'
        }
      }
    } as ChartDimension
  ))
  
  const measures = answer.measure ?  [answer.measure] : (answer.measures ?? [])
  chartAnnotation.measures = measures.map((measure) => (
    {
      ...measure,
      dimension: C_MEASURES,
      chartOptions: {
        ...(measure.chartOptions ?? {}),
        // dataZoom: {
        //   type: 'slider'
        // }
      },
      formatting: {
        shortNumber: true
      },
      palette: {
        name: 'Viridis'
      }
    } as ChartMeasure))

  return {
    chartAnnotation,
    slicers: answer.slicers ?? answer.filters, // 因为过滤器会被翻译成 filters
    limit: answer.limit,
    chartOptions: answer.chartOptions ?? answer.chartType?.chartOptions
  }
}
