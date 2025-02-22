import { inject, Injectable } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import {
  AIOptions,
  BusinessOperation,
  CopilotChatMessage,
  CopilotChatMessageRoleEnum,
  CopilotChatResponseChoice,
  CopilotEngine,
  DefaultModel
} from '@metad/copilot'
import { Cube, PropertyDimension } from '@metad/ocap-core'
import { TranslateService } from '@ngx-translate/core'
import { NgmCopilotService } from '@metad/core'
import { map, of, switchMap } from 'rxjs'
import { SemanticModelService } from './model.service'
import { uuid } from '../../../@core'
import { ModelDimensionState, SemanticModelEntityType } from './types'

type ModelCopilotAction = 'CreateDimension' | 'CreateCube' | 'FreePrompt'


@Injectable()
export class ModelCopilotEngineService implements CopilotEngine {
  private copilotService = inject(NgmCopilotService)
  private readonly translateService = inject(TranslateService)
  private readonly modelService = inject(SemanticModelService)


  get name() {
    return this._name()
  }
  private readonly _name = toSignal(this.translateService.stream('PAC.MODEL.MODEL.CopilotName', { Default: 'Modeling' }))

  aiOptions = {
    model: DefaultModel,
    useSystemPrompt: true
  } as AIOptions

  get prompts() {
    return this._prompts()
  }
  private readonly _prompts = toSignal(
    this.translateService.stream('PAC.MODEL.MODEL.CopilotDefaultPrompts', {
      Default: [
        `Create cube by table `,
        `Create dimension by table `,
      ]
    })
  )

  conversations: CopilotChatMessage[] = []

  businessAreas = [
    {
      businessArea: 'Prompt',
      action: 'FreePrompt',
      prompts: {
        zhHans: '自由提问'
      },
      language: 'text',
      format: 'text'
    },
    {
      businessArea: 'Dimension',
      action: 'CreateDimension',
      prompts: {
        zhHans: '创建维度'
      },
      language: 'dimension',
      format: 'json'
    },
    {
      businessArea: 'Cube',
      action: 'CreateCube',
      prompts: {
        zhHans: '创建数据集'
      },
      language: 'cube',
      format: 'json'
    }
  ]

  get systemPrompt() {
    return `预设条件：${JSON.stringify({
      BusinessAreas: this.businessAreas
    })}
根据问题给出涉及到的多个 action 相应 language in format 的答案，value 值使用 object，不用注释，不用额外属性，例如
问题：根据表 product (id string, name string, type string) 信息创建产品维度
答案：
{
  "action": "CreateDimension",
  "value": {
    "name": "product",
    "caption": "产品",
    "hierarchies": [
      {
        "name": "",
        "caption": "产品",
        "tables": [
          {
            "name": "product"
          }
        ],
        "levels": [
          {
            "name": "type",
            "column": "type",
            "caption": "类型"
          },
          {
            "name": "name",
            "column": "name",
            "caption": "名称"
          }
        ]
      }
    ]
  }
}
`
  }

  process({prompt, messages}) {
    return of(prompt).pipe(
      switchMap(() => this.preprocess(prompt, this.aiOptions)),
      map((action) => this.assignAction(action, prompt)),
      switchMap((systemPrompt) => {
        const _messages = []
        if (systemPrompt) {
          _messages.push({
            role: CopilotChatMessageRoleEnum.System,
            content: systemPrompt
          })
        }

        let userPrompt = prompt
        for (let index = messages.length - 1; index > -1; index--) {
          const message = messages[index]
          // 汇总最新的连续的提问消息内容
          if (message.role !== CopilotChatMessageRoleEnum.User || message.end) {
            break
          }

          userPrompt += '\n' + message.content
        }

        _messages.push({
          role: CopilotChatMessageRoleEnum.User,
          content: `请回答
问题：${userPrompt}
答案：`
        })

        return this.copilotService.chatCompletions(_messages, this.aiOptions).pipe(
          map(({choices}) => choices)
        )
      }),
      switchMap((choices) => this.postprocess(prompt, choices))
    )
  }

  preprocess(prompt: string, options?) {
    return this.copilotService.chatCompletions(
      [
        {
          role: CopilotChatMessageRoleEnum.System,
          content: `预设条件：${JSON.stringify({
            BusinessAreas: this.businessAreas
          })}
根据预设条件将问题划分到相应的 action，value 值使用 object，不用注释，不用额外属性，例如
问题：根据表 product (id string, name string, type string) 信息创建产品维度
答案：
{
  "action": "CreateDimension"
}
问题：如何查询 Mysql 数据库中的表信息
答案：
{
  "action": "FreePrompt"
}
`
        },
        {
          role: CopilotChatMessageRoleEnum.User,
          content: `请回答
问题：${prompt}
答案：`
        }
      ],
      options
    ).pipe(
      map(({choices}) => {
        let res
        try {
          res = JSON.parse(choices[0].message.content)
          return res.action
        } catch (err) {
          return 'FreePrompt'
        }
      })
    )
  }

  postprocess(prompt: string, choices: CopilotChatResponseChoice[]) {
    let res
    try {
      res = JSON.parse(choices[0].message.content)
    } catch (err) {
      return of([
        {
          role: CopilotChatMessageRoleEnum.Assistant,
          content: choices[0].message.content
        }
      ])
    }

    if (!Array.isArray(res)) {
      res = [res]
    }

    const messages = []
    res.forEach((operation: BusinessOperation) => {
      try {
        switch (operation.action) {
          case 'CreateDimension':
            this.createDimension(operation.value)
            break
          case 'CreateCube':
            this.createCube(operation.value)
            break
        }

        messages.push({
          role: CopilotChatMessageRoleEnum.Assistant,
          content:
            typeof operation.value === 'string'
              ? operation.value
              : `任务 **${
                  this.businessAreas.find((item) => item.action === operation.action)?.prompts.zhHans
                }** 执行完成`
        })
      } catch (err: any) {
        messages.push({
          role: CopilotChatMessageRoleEnum.Assistant,
          content: '',
          error: err.message
        })
      }
    })

    return of(messages)
  }

  assignAction(action: ModelCopilotAction, prompt: string) {
    if (action === 'CreateDimension') {
      return this.createDimensionPrompt(prompt)
    } else if (action === 'CreateCube') {
      return this.createCubePrompt(prompt)
    } else {
      return null
    }
  }

  createDimensionPrompt(prompt: string) {
    return `根据表结构给出创建维度 Dimension 的数据结构 json 格式, 不用注释, 不用额外属性, 例如问题: Table "product" (id string, product_category string, product_name string, product_family string) 创建维度
答案:
{
  "action": "CreateDimension",
  "value": {
    "name": "Product",
    "caption": "产品",
    "hierarchies": [
      {
        "name": "",
        "caption": "产品",
        "tables": [
          {
            "name": "product"
          }
        ],
        "primaryKey": "id",
        "levels": [
          {
            "name": "Family",
            "column": "product_family",
            "caption": "系列"
          },
          {
            "name": "Category",
            "column": "product_category",
            "caption": "类别"
          },
          {
            "name": "name",
            "column": "id",
            "captionColumn": "product_name"
            "caption": "名称"
          }
        ]
      }
    ]
  }
}`
  }

  createCubePrompt(prompt: string) {
    return `根据表结构给出创建数据集 Cube 的数据结构 json 格式, 将可能属于同一个维度的表字段划分到同一维度的 Hierarchy Levels 里, 如 product_category product_id product_name 属于 Product dimension, 不用注释, 不用额外属性, 例如问题: Table "sales" (id string, product_category string, product_id string, product_name string, channel string, amount number) 创建多维数据集
答案:
{
  "action": "CreateCube",
  "value": {
    "name": "Sales",
    "caption": "销售",
    "tables": [
      {
        "name": "sales"
      }
    ],
    "measures": [
      {
        "name": "amount",
        "caption": "金额",
        "column": "amount",
      }
    ],
    "dimensions": [
      {
        "name": "Channel",
        "caption": "渠道",
        "hierarchies": [
          {
            "name": "",
            "caption": "渠道",
            "levels": [
              {
                "name": "Channel",
                "caption": "渠道",
                "column": "channel",
              }
            ]
          }
        ]
      },
      {
        "name": "Product",
        "caption": "产品",
        "hierarchies": [
          {
            "name": "",
            "caption": "产品",
            "levels": [
              {
                "name": "Category",
                "caption": "产品",
                "column": "product_category",
              },
              {
                "name": "Product",
                "caption": "产品",
                "column": "product_id",
                "captionColumn": "product_name"
              }
            ]
          }
        ]
      }
    ]
  }
}
`
  }

  createDimension(dimension: PropertyDimension) {
    const key = uuid()
    const dimensionState: ModelDimensionState = {
      type: SemanticModelEntityType.DIMENSION,
      id: key,
      name: dimension.name,
      caption: dimension.caption,
      dimension: {
        ...dimension,
        __id__: key,
        hierarchies: dimension.hierarchies?.map((hierarchy) => ({
          ...hierarchy,
          __id__: uuid(),
          levels: hierarchy.levels?.map((level) => ({...level, __id__: uuid()}))
        }))
      },
    }
    this.modelService.newDimension(dimensionState)
    this.modelService.activeEntity(dimensionState)
  }

  createCube(cube: Cube) {
    const key = uuid()
    const cubeState = {
      type: SemanticModelEntityType.CUBE,
      id: key,
      name: cube.name,
      caption: cube.caption,
      cube: {
        ...cube,
        __id__: key,
        measures: cube.measures?.map((measure) => ({...measure, __id__: uuid(), visible: true})),
        dimensions: cube.dimensions?.map((dimension) => ({
          ...dimension,
          __id__: uuid(),
          hierarchies: dimension.hierarchies?.map((hierarchy) => ({
            ...hierarchy,
            __id__: uuid(),
            levels: hierarchy.levels?.map((level) => ({...level, __id__: uuid()}))
          }))
        }))
      },
      sqlLab: {},
    }
    this.modelService.newEntity(cubeState)
    this.modelService.activeEntity(cubeState)
  }

}
