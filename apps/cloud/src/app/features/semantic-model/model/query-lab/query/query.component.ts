import { CdkDrag, CdkDragDrop } from '@angular/cdk/drag-drop'
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { FormControl } from '@angular/forms'
import { ActivatedRoute } from '@angular/router'
import { CopilotChatMessageRoleEnum } from '@metad/copilot'
import { effectAction } from '@metad/ocap-angular/core'
import { EntityCapacity, EntitySchemaNode, EntitySchemaType } from '@metad/ocap-angular/entity'
import { EntityType, uniqBy } from '@metad/ocap-core'
import { serializeName } from '@metad/ocap-sql'
import { BaseEditorDirective } from '@metad/components/editor'
import { convertQueryResultColumns } from '@metad/core'
import { CopilotService, ToastrService, calcEntityTypePrompt } from 'apps/cloud/src/app/@core'
import { CopilotChatComponent, TranslationBaseComponent } from 'apps/cloud/src/app/@shared'
import { isEqual, isPlainObject } from 'lodash-es'
import { NgxPopperjsContentComponent, NgxPopperjsPlacements, NgxPopperjsTriggers } from 'ngx-popperjs'
import { BehaviorSubject, EMPTY, Observable, combineLatest, firstValueFrom } from 'rxjs'
import { catchError, delay, distinctUntilChanged, filter, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators'
import { ModelComponent } from '../../model.component'
import { SemanticModelService } from '../../model.service'
import { MODEL_TYPE, QueryResult } from '../../types'
import { quoteLiteral } from '../../utils'
import { QueryLabService } from '../query-lab.service'
import { QueryCopilotEngineService } from './copilot.service'

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'pac-model-query',
  templateUrl: 'query.component.html',
  styleUrls: ['query.component.scss'],
  providers: [QueryCopilotEngineService]
})
export class QueryComponent extends TranslationBaseComponent implements OnDestroy {
  MODEL_TYPE = MODEL_TYPE
  NgxPopperjsTriggers = NgxPopperjsTriggers
  NgxPopperjsPlacements = NgxPopperjsPlacements
  EntityCapacity = EntityCapacity

  private readonly copilotService = inject(CopilotService)
  private readonly copilotEngine = inject(QueryCopilotEngineService)
  private readonly modelComponent = inject(ModelComponent)
  public readonly modelService = inject(SemanticModelService)
  public readonly queryLabService = inject(QueryLabService)
  private readonly _cdr = inject(ChangeDetectorRef)
  private readonly route = inject(ActivatedRoute)
  private readonly _toastrService = inject(ToastrService)

  @ViewChild('editor') editor!: BaseEditorDirective
  @ViewChild('copilotChat') copilotChat!: CopilotChatComponent

  queryKey: string
  // statement = ''
  public entities = []

  get dataSourceName() {
    return this.modelService.originalDataSource?.options.name
  }

  get dbInitialization() {
    return this.modelService.model?.dbInitialization
  }

  textSelection: {
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
      selectionStartLineNumber: number
    }
    text: string
  }
  get selectedStatement() {
    return this.textSelection?.text || this.statement
  }

  // Copilot
  prompt = new FormControl<string>(null)
  answering = signal(false)
  private entityTypes: EntityType[]
  private get promptTables() {
    return this.entityTypes?.map((entityType) => {
      return `Table name: "${entityType.name}", table caption: "${entityType.caption}" columns: [${Object.keys(
        entityType.properties
      )
        .map(
          (key) =>
            `${serializeName(key, entityType.dialect)} ${entityType.properties[key].dataType}` +
            (entityType.properties[key].caption ? ` ${entityType.properties[key].caption}` : '')
        )
        .join(', ')}]`
    })
  }

  public readonly queryId$ = this.route.paramMap.pipe(
    startWith(this.route.snapshot.paramMap),
    map((paramMap) => paramMap.get('id')),
    filter((value) => !!value),
    map(decodeURIComponent),
    distinctUntilChanged()
  )

  public readonly queryState$ = this.queryId$.pipe(
    switchMap((id) => this.queryLabService.selectQuery(id)),
    filter((value) => !!value),
    shareReplay(1)
  )
  public readonly query$ = this.queryState$.pipe(
    map((state) => state.query),
    shareReplay(1)
  )
  public readonly results$ = this.queryState$.pipe(
    map((state) => state.results),
    shareReplay(1)
  )
  // public readonly statement$ = this.query$.pipe(map((query) => query.statement))
  private readonly _statement = toSignal(this.query$.pipe(map((query) => query.statement)))
  get statement() {
    return this._statement()
  }
  set statement(value) {
    this.onStatementChange(value)
  }

  // public readonly entitySets$ = this.modelService.entities$
  public readonly tables$ = this.modelService.selectDBTables$
  // 当前使用 MDX 查询
  private readonly modelType = toSignal(this.modelService.modelType$)
  public readonly useMDX = computed(() => this.modelType() === MODEL_TYPE.XMLA)
  public readonly useSaveAsSQL = computed(() => this.modelType() === MODEL_TYPE.SQL)
  public readonly isWasm = toSignal(this.modelService.isWasm$)

  public readonly conversations$ = this.query$.pipe(map((query) => query.conversations))

  // for results table
  public readonly loading$ = new BehaviorSubject<boolean>(false)
  error: string

  get results() {
    return this.queryLabService.results[this.queryKey]
  }
  set results(value) {
    this.queryLabService.results[this.queryKey] = value
  }
  get activeResult() {
    return this.queryLabService.activeResults[this.queryKey]
  }
  set activeResult(value) {
    this.queryLabService.activeResults[this.queryKey] = value
  }
  get dirty() {
    return this.queryLabService.dirty[this.queryKey]
  }
  set dirty(value) {
    this.queryLabService.dirty[this.queryKey] = value
  }
  get isDirty$() {
    return this.dirty
  }

  sqlEditorActionLabel = toSignal(
    this.translateService.stream('PAC.MODEL.QUERY.EditorActions', {
      Default: {
        Nl2SQL: 'NL 2 SQL',
        Explain: 'Explain',
        Optimize: 'Optimize'
      }
    })
  )
  sqlEditorActions = [
    {
      id: `sql-editor-action-nl-sql`,
      label: computed(() => this.sqlEditorActionLabel().Nl2SQL),
      action: (text, options) => {
        console.log(options)
        const statement = text || this.statement
        if (statement) {
          this.answering.set(true)
          this.copilotEngine.nl2SQL(statement).subscribe((result) => {
            this.answering.set(false)
            const lines = this.statement.split('\n')
            const endLineNumber = text ? options.selection.endLineNumber : lines.length
            lines.splice(endLineNumber, 0, result)
            this.statement = lines.join('\n')
          })
        }
      }
    },
    {
      id: `sql-editor-action-explain-sql`,
      label: computed(() => this.sqlEditorActionLabel().Explain),
      action: (text, options) => {
        const statement = text || this.statement
        if (statement) {
          this.answering.set(true)
          this.copilotEngine.explainSQL(statement).subscribe((result) => {
            this.answering.set(false)
            const startLineNumber = text ? options.selection.startLineNumber : 1
            const lines = this.statement.split('\n')
            lines.splice(startLineNumber - 1, 0, `/**\n${result}\n*/`)
            this.statement = lines.join('\n')
          })
        }
      }
    },
    {
      id: `sql-editor-action-optimize-sql`,
      label: computed(() => this.sqlEditorActionLabel().Optimize),
      action: (text, options) => {
        const statement = text || this.statement
        if (statement) {
          this.answering.set(true)
          this.copilotEngine.optimizeSQL(statement).subscribe((result) => {
            this.answering.set(false)
            this.statement = this.statement.replace(statement, result)
          })
        }
      }
    }
  ]

  // Subscribers
  private _entitiesSub = this.query$.pipe(map((query) => query.entities)).subscribe(async (entities) => {
    this.entities = [...(entities ?? [])]
    this.entityTypes = await firstValueFrom(
      combineLatest(this.entities.map((entity) => this.modelService.selectOriginalEntityType(entity)))
    )
    // Calculate system prompts
    this.copilotEngine.dbTablesPrompt.set(
      `The database dialect is ${this.entityTypes[0]?.dialect}, the tables information are ${this.promptTables?.join(
        '\n'
      )}`
    )
  })

  private queryKeySub = this.queryId$.subscribe((key) => {
    this.queryKey = key
  })
  // private statementSub = this.statement$.subscribe((statement) => (this.statement = statement))
  private dirtySub = this.queryState$.subscribe((state) => {
    this.dirty = !isEqual(state.origin, state.query)
  })
  constructor() {
    super()
    // 设置当前 Chat Copilot Engine
    this.modelComponent.copilotEngine = this.copilotEngine
  }

  onSelectionChange(event) {
    this.textSelection = event
  }

  editorDropPredicate(event: CdkDrag<EntitySchemaNode>) {
    // 排除 query results 拖进来
    return !['pac-model__query-results'].includes(event.dropContainer.id)
  }

  query = effectAction((origin$: Observable<string>) => {
    return origin$.pipe(
      tap((statement) => {
        if (statement) {
          this.error = null
          this.loading$.next(true)
        } else {
          this.error = null
          this.loading$.next(false)
        }
      }),
      switchMap((statement) =>
        statement
          ? this.modelService.originalDataSource.query({ statement }).pipe(
              catchError((error) => {
                this.error = error
                this.appendResult({
                  statement,
                  error
                })
                this.loading$.next(false)
                this._cdr.detectChanges()
                return EMPTY
              }),
              tap((result) => {
                const { status, error, schema } = result
                let { data } = result

                if (status === 'ERROR' || error) {
                  console.error(error)
                  this.error = error || status

                  this.appendResult({
                    statement,
                    error
                  })

                  this._cdr.detectChanges()
                  return
                }

                try {
                  const columns = convertQueryResultColumns(schema)

                  if (isPlainObject(data)) {
                    columns.push(...typeOfObj(data))
                    data = [data]
                  }

                  let preview = data
                  if (data?.length > 1000) {
                    preview = data.slice(0, 1000)
                  }

                  this.appendResult({
                    statement,
                    data,
                    columns: uniqBy(columns, 'name'),
                    preview,
                    stats: {
                      numberOfEntries: data?.length ?? 0
                    }
                  })

                  this.loading$.next(false)
                  this._cdr.detectChanges()
                } catch (err) {
                  console.error(err)
                }
              })
            )
          : EMPTY
      )
    )
  })

  cancelQuery() {
    this.query('')
  }

  appendResult(result: QueryResult) {
    this.results = this.results ?? []
    this.results.push(result)
    this.activeResult = this.results[this.results.length - 1]
  }

  async run() {
    const statement: string = this.editor.getSelectText()?.trim() || this.statement
    this.query(statement)
  }

  async onEditorKeyDown(event) {
    if (event.code === 'F8') {
      await this.run()
    }
  }

  onStatementChange(event: string) {
    if (this.queryKey) {
      this.queryLabService.setStatement({ key: this.queryKey, statement: event })
    }
  }

  /**
   * 另存为 SQL Model
   */
  saveAsModel() {
    this.modelComponent.createByExpression(this.statement)
  }

  async saveAsDBScript() {
    const statement: string = this.editor.getSelectText()?.trim() || this.statement
    this.modelService.updateModel({ dbInitialization: statement })
  }

  dropEntity(event: CdkDragDrop<{ name: string }[]>) {
    if (event.previousContainer.id === 'pac-model-entitysets') {
      if (event.item.data?.name) {
        this.queryLabService.addEntity({
          key: this.queryKey,
          entity: event.item.data?.name,
          currentIndex: event.currentIndex
        })
      }
    } else if (event.container === event.previousContainer) {
      this.queryLabService.moveEntityInQuery({ key: this.queryKey, event })
    }
  }

  drop(event: CdkDragDrop<{ name: string }[]>) {
    const text = event.item.data?.name
    if (text) {
      this.editor.insert(text)
    }
  }

  /**
   * Drop in query results
   *
   * @param event
   */
  async dropTable(event: CdkDragDrop<{ name: string }[]>) {
    const modelType = await firstValueFrom(this.modelService.modelType$)
    const dialect = this.modelService.originalDataSource.options.dialect
    let statement = ''
    if (modelType === MODEL_TYPE.XMLA) {
      statement = await this.getXmlaQueryStatement(event.item.data)
    } else {
      if (event.item.data) {
        if (event.item.data.type === EntitySchemaType.Member) {
          statement = `SELECT * FROM ${serializeName(event.item.data.entity, dialect)} WHERE ${serializeName(
            event.item.data.dimension,
            dialect
          )} = ${quoteLiteral(event.item.data.memberKey)}`
        } else if (event.item.data.type === EntitySchemaType.Dimension) {
          statement = `SELECT DISTINCT ${serializeName(event.item.data.column, dialect)} FROM ${serializeName(
            event.item.data.entity,
            dialect
          )}`
        } else if (event.item.data.type === EntitySchemaType.IMeasure) {
          statement = `SELECT SUM(${serializeName(event.item.data.name, dialect)}), AVG(${serializeName(
            event.item.data.name,
            dialect
          )}), MAX(${serializeName(event.item.data.name, dialect)}), MIN(${serializeName(
            event.item.data.name,
            dialect
          )}) FROM ${serializeName(event.item.data.entity, dialect)}`
        } else {
          statement = `SELECT * FROM ${serializeName(event.item.data.name, dialect)} LIMIT 1000`
        }
      }
    }

    if (statement) {
      this.query(statement)
    }
  }

  async getXmlaQueryStatement(data) {
    if (data.cubeType === 'CUBE' || data.cubeType === 'QUERY CUBE') {
      return `SELECT {[Measures].Members} ON COLUMNS FROM [${data.name}]`
    } else if ((<EntitySchemaNode>data).type === EntitySchemaType.Entity) {
      return `SELECT {[Measures].Members} ON COLUMNS FROM [${data.name}]`
    } else if ((<EntitySchemaNode>data).type === EntitySchemaType.Dimension) {
      return `SELECT {[Measures].Members} ON COLUMNS, {${data.name}.Members} ON ROWS FROM [${data.entity}]`
    } else if (
      (<EntitySchemaNode>data).type === EntitySchemaType.Hierarchy ||
      (<EntitySchemaNode>data).type === EntitySchemaType.Level
    ) {
      return `SELECT {[Measures].Members} ON COLUMNS, {${data.name}.${data.allMember || 'Members'}} ON ROWS FROM [${
        data.cubeName
      }]`
    } else if ((<EntitySchemaNode>data).type === EntitySchemaType.Member) {
      return `SELECT {[Measures].Members} ON COLUMNS, {${data.raw.memberUniqueName}} ON ROWS FROM [${data.raw.cubeName}]`
    } else if ((<EntitySchemaNode>data).type === EntitySchemaType.Field) {
      return `SELECT {[Measures].Members} ON COLUMNS, {${data.levelUniqueName}.Members} DIMENSION PROPERTIES ${data.name} ON ROWS FROM [${data.cubeName}]`
    }

    return ``
  }

  entityDeletePredicate(item: CdkDrag<EntitySchemaNode>) {
    return item.data.type === EntitySchemaType.Entity
  }

  deleteEntity(event: CdkDragDrop<{ name: string }[]>) {
    this.queryLabService.removeEntity({ key: this.queryKey, entity: event.item.data.name })
  }

  deleteResult(i: number) {
    let index = this.results.indexOf(this.activeResult)
    this.results.splice(i, 1)
    if (index >= i) {
      index--
    }
    if (index === -1) {
      index = 0
    }
    this.activeResult = this.results[index]
  }

  closeAllResults() {
    this.results = []
    this.activeResult = null
  }

  save() {
    this.queryLabService.save(this.queryKey)
  }

  triggerFormat() {
    this.editor.formatDocument()
  }

  triggerCompress() {
    this.editor.compressDocument()
  }

  triggerClear() {
    this.editor.clearDocument()
  }

  triggerFind() {
    this.editor.startFindAction()
  }

  triggerUndo() {
    this.editor.undo()
  }

  triggerRedo() {
    this.editor.redo()
  }

  onConversationsChange(event) {
    this.queryLabService.setConversations({ key: this.queryKey, conversations: event })
  }

  async dropCopilot(event: CdkDragDrop<any[], any[], any>) {
    const data = event.item.data
    if (event.previousContainer.id === 'pac-model__query-entities' && (<EntitySchemaNode>data).type === 'Entity') {
      const entityType = await firstValueFrom(this.modelService.selectOriginalEntityType((<EntitySchemaNode>data).name))
      this.copilotChat.addMessage({
        role: CopilotChatMessageRoleEnum.User,
        content: calcEntityTypePrompt(entityType)
      })
    } else if (event.previousContainer.id === 'pac-model__query-results') {
      this.copilotChat.addMessage({
        role: CopilotChatMessageRoleEnum.User,
        data: {
          columns: data.columns,
          content: data.preview
        },
        content:
          data.columns.map((column) => column.name).join(',') +
          `\n` +
          data.preview.map((row) => data.columns.map((column) => row[column.name]).join(',')).join('\n')
      })
    }
  }

  askCopilot(prompt: string, askPopper: NgxPopperjsContentComponent) {
    this.prompt.setValue(null)
    this.answering.set(true)
    askPopper.hide()
    this.copilotEngine.ask(prompt)
      .pipe(
        tap(() => this.answering.set(false)),
        delay(200) // 等待 Editor 从 read-only 切换到 editable 状态
      )
      .subscribe({
        next: (result) => {
          const selection = this.editor.editor.getSelection()
          this.editor.insert(result, {
            column: selection.endColumn,
            lineNumber: selection.endLineNumber
          })
        },
        error: () => {
          this.answering.set(false)
        }
      })
  }

  triggerAsk(event, askPopper: NgxPopperjsContentComponent) {
    if (event.ctrlKey && event.key === 'Enter') {
      this.askCopilot(this.prompt.value, askPopper)
    }
  }

  onCopilotCopy(text: string) {
    this.editor.appendText(text)
  }

  export() {
    this._export('QueryLabResult', this.activeResult.data, this.activeResult.columns)
  }

  async _export(name: string, data: any[], COLUMNS) {
    const xlsx = await import('xlsx')

    const hNameRow = {}
    const headerRow = {}
    COLUMNS.forEach(({ name, label }) => {
      hNameRow[name] = name
      headerRow[name] = label || name
    })

    data = data.map((item) => {
      const row = {}
      COLUMNS.forEach((col) => {
        row[col.name] = item[col.name]
      })
      return row
    })

    /* generate worksheet */
    const ws /**: xlsx.WorkSheet */ = xlsx.utils.json_to_sheet([headerRow, ...data], {
      header: COLUMNS.map(({ name }) => name),
      skipHeader: true
    })

    /* generate workbook and add the worksheet */
    const wb /**: XLSX.WorkBook */ = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'Sheet1')

    let fileName = `${name}.xlsx`
    /* save to file */
    xlsx.writeFile(wb, fileName)
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'F8') {
      this.run()
      event.preventDefault()
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 's' || event.key === 'S')) {
      this.saveAsModel()
      event.preventDefault()
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
      this.save()
      event.preventDefault()
    }
  }

  ngOnDestroy(): void {
    this.modelComponent.copilotEngine = null
  }
}

/**
 * 根据 SQL 查询结果对象分析出字段类型
 *
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof
 *
 * @param obj
 * @returns
 */
export function typeOfObj(obj) {
  return Object.entries(obj).map(([key, value]) => ({
    name: key,
    type: value === null || value === undefined ? null : typeof value
  }))
}
