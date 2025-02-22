import { BreakpointObserver, Breakpoints, BreakpointState } from '@angular/cdk/layout'
import { inject, Inject, Injectable, Injector, Optional } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { NgmDSCoreService } from '@metad/ocap-angular/core'
import { ComponentStore, DirtyCheckQuery } from '@metad/store'
import { ID, IStoryTemplate, StoryTemplateType } from '@metad/contracts'
import { ConfirmUniqueComponent } from '@metad/components/confirm'
import { getErrorMessage, Intent, isNotEmpty, nonNullable, NxCoreService } from '@metad/core'
import {
  AggregationRole,
  CalculationProperty,
  C_MEASURES,
  DataSettings,
  EntityType,
  isMeasureControlProperty,
  isRestrictedMeasureProperty,
  MeasureControlProperty,
  ParameterProperty,
  Property,
  Schema,
  mergeEntitySets,
  isEntityType,
  DataSourceSettings,
  assignDeepOmitBlank,
} from '@metad/ocap-core'
import { TranslateService } from '@ngx-translate/core'
import { cloneDeep, findKey, includes, isEmpty, isEqual, isNil, merge, omit, some, sortBy } from 'lodash-es'
import { NGXLogger } from 'ngx-logger'
import { BehaviorSubject, combineLatest, firstValueFrom, Observable, of, Subject } from 'rxjs'
import {
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  tap,
  withLatestFrom
} from 'rxjs/operators'
import { NxStoryStore, NX_STORY_STORE } from './story-store.service'
import {
  cssStyle,
  FlexLayout,
  getDefaultPageGrid,
  Story,
  StoryEvent,
  StoryEventType,
  StoryFilterBar,
  StoryOptions,
  StoryPoint,
  StoryPointType,
  StoryPreferences,
  StoryState,
  StoryWidget,
  uuid,
  WidgetComponentType,
  WIDGET_INIT_POSITION,
  StoryPointState,
  MoveDirection
} from './types'
import { convertStoryModel2DataSource, getSemanticModelKey, prefersColorScheme } from './utils'


@Injectable()
export class NxStoryService extends ComponentStore<StoryState> {
  private readonly translateService = inject(TranslateService)

  get story() {
    return this.get((state) => state.story)
  }

  get creatingWidget() {
    return this.get((state) => state.creatingWidget)
  }
  
  private saved$ = new Subject<void>()
  public readonly saving$ = new BehaviorSubject<boolean>(false)

  private readonly refresh$ = new Subject<boolean>()

  /**
   * 当前运行环境是否为移动端
   */
  readonly mediaMatcher$ = combineLatest(
    Object.keys(Breakpoints).map((name) => {
      return this.breakpointObserver
        .observe([Breakpoints[name]])
        .pipe(map((state: BreakpointState) => [name, state.matches]))
    })
  ).pipe(map((breakpoints) => breakpoints.filter((item) => item[1]).map((item) => item[0])))
  public readonly isMobile$ = this.mediaMatcher$.pipe(
    map((values) => some(['XSmall', 'Small', 'HandsetPortrait'], (el) => includes(values, el))),
    distinctUntilChanged(),
    shareReplay(1)
  )

  readonly story$ = this.select((state) => state.story)
  readonly id$ = this.select((state) => state.story?.id)
  
  // Story options merge template
  public readonly storyOptions$ = this.story$.pipe(
    filter((story) => Boolean(story?.id)), map((story) => story?.options), distinctUntilChanged(isEqual),
    shareReplay(1)
  )

  // 语言代码
  readonly locale$ = this.storyOptions$.pipe(map((options) => options?.locale), distinctUntilChanged())
  readonly preferences$: Observable<StoryPreferences> = this.storyOptions$.pipe(
    map((options) => options?.preferences),
    distinctUntilChanged()
  )
  readonly advancedStyle$ = this.storyOptions$.pipe(
    map((options) => options?.advancedStyle),
    distinctUntilChanged()
  )
  readonly echartsTheme$ = this.storyOptions$.pipe(
    map((options) => options?.echartsTheme),
    distinctUntilChanged()
  )
  readonly appearance$ = this.preferences$.pipe(map((preferences) => preferences?.story?.appearance))
  
  // 全局固定过滤条件
  public readonly filters$ = this.storyOptions$.pipe(
    map((options) => options?.filters),
    distinctUntilChanged()
  )

  readonly storyModel$ = this.select((state) => state.story.model)
  readonly storyModels$ = combineLatest([this.storyModel$, this.select((state) => state.story.models)]).pipe(
    map(([model, models]) => {
      const _models = [...(models ?? [])]
      if (model && !some(_models, { id: model.id })) {
        _models.push(model)
      }
      return _models
    })
  )

  // Convert semantic model and combine model alias in story
  readonly dataSourceOptions$ = this.storyModels$.pipe(
    map((models) => models.map((model) => convertStoryModel2DataSource(model))),
    shareReplay(1)
  )

  readonly dataSources$ = this.dataSourceOptions$.pipe(
    map((dataSources) => dataSources.map((dataSource) => ({
      key: dataSource.id,
      value: dataSource.key ?? dataSource.name,
      caption: dataSource.caption
    })))
  )

  readonly schemas$ = combineLatest([
    this.select((state) => state.story.schema),
    this.select((state) => state.story.schemas)
  ]).pipe(
    map(([schema, schemas]) => {
      const model = this.get((state) => state.story.model)
      schemas = cloneDeep(schemas) ?? {}
      if (schema && model) {
        const newSchema = schemas[getSemanticModelKey(model)]
        schemas[getSemanticModelKey(model)] = assignDeepOmitBlank(newSchema, schema)
      }
      return schemas
    }),
    takeUntilDestroyed(),
    shareReplay(1)
  )

  public readonly themeName$ = this.storyOptions$.pipe(
    map((options) => options?.preferences?.story?.themeName || options?.themeName),
    distinctUntilChanged()
  )

  // System theme
  private prefersColorScheme$ = prefersColorScheme()
  public readonly themeChanging$ = combineLatest([this.themeName$, this.prefersColorScheme$]).pipe(
    map(([themeName, prefersColorScheme]) => {
      if (!themeName || themeName === 'system') {
        return prefersColorScheme
      }
      return themeName || 'light'
    }),
    startWith(null),
    pairwise()
  )
  public readonly editable$ = this.select((state) => state.editable)
  public readonly currentPageKey$ = this.select((state) => state.currentPageKey)

  public readonly pageStates$ = this.select((state) => state.points).pipe(filter(nonNullable))
  readonly points$ = this.pageStates$.pipe(
    map((states) => states.filter((item) => !item.removed).map((item) => item.storyPoint))
  )
  readonly displayPoints$ = combineLatest([
      this.points$,
      this.editable$,
      this.currentPageKey$
    ]).pipe(
      map(([points, editable, currentPageKey]) => {
        return sortBy(
          points?.filter((item) => editable || !item.hidden || item.key === currentPageKey) || [],
          'index'
        )
      }),
      shareReplay(1)
    )

  public readonly isEmpty$ = this.pageStates$.pipe(map((points) => isEmpty(points)))
  
  readonly currentIndex$ = this.select(this.displayPoints$, this.currentPageKey$, (displayPoints, currentPageKey) =>
    displayPoints?.findIndex((item) => item.key === currentPageKey)
  )
  public readonly currentPage$ = combineLatest([this.currentPageKey$, this.pageStates$]).pipe(
    map(([currentPageKey, pageStates]) => {
      return pageStates.find((pageState) => pageState.key === currentPageKey)
    })
  )
  public readonly currentPageWidgets$ = this.currentPage$.pipe(
    map((pageState) => pageState?.widgets),
  )
  readonly currentWidget$ = this.select((state) => state.currentWidget)
  readonly copySelectedWidget$ = this.select((state) => state.copySelectedWidget)

  public readonly isAuthenticated$ = this.select((state) => state.isAuthenticated)
  public readonly isPanMode$ = this.select((state) => state.isPanMode)

  // FilterBar merge with global appearance
  public readonly filterBar$ = combineLatest([
    this.appearance$,
    this.select((state) => state.story?.filterBar)
  ]).pipe(
    map(([appearance, filterBar]) => {
      return filterBar ? merge({
        styling: {
          appearance
        }
      }, filterBar) : null
    }),
    shareReplay(1)
  )

  // toolbar events
  private _storyEvent$ = new Subject<StoryEvent>()
  public readonly creatingWidget$ = this.select((state) => state.creatingWidget)
  public save$ = new Subject<void>()
  dirtyCheckQuery: DirtyCheckQuery = new DirtyCheckQuery(this, {
    watchProperty: ['story'],
    clean: (head, current) => {
      // Start saving
      this.saving$.next(true)
      return this._saveStory(head.story, current.story).pipe(
        tap({
          next: () => {
            const successMessage = this.getTranslation('Story.Story.SaveSuccess', 'Save success')
            this._snackBar.open(successMessage, '', {
              duration: 2000
            })
            this.save$.next()
            this.saving$.next(false)
          },
          error: (error) => {
            const errorMessage = this.getTranslation('Story.Story.SaveFailed', 'Save failed')
            this._snackBar.open(errorMessage, getErrorMessage(error.statusText), {
              duration: 2000
            })
            this.saving$.next(false)
          }
        })
      )
    }
  })

  readonly dirty$ = this.select(
    this.dirtyCheckQuery.isDirty$.pipe(startWith(false)),
    this.select((state) => state.points),
    (dirty, points) => {
      return dirty || !!points?.find(({ dirty, removed }) => dirty || removed)
    }
  ).pipe(shareReplay(1))

  public readonly storySizeStyles$ = combineLatest([
    this.editable$,
    this.storyOptions$.pipe(map((options) => options?.emulatedDevice))
  ]).pipe(
    map(([editable, emulatedDevice]) => {
      if (editable) {
        return {
          width: null,
          height: null
        }
      } else {
        return {
          width: emulatedDevice?.width ? emulatedDevice.width + 'px' : null,
          height: emulatedDevice?.height ? emulatedDevice.height + 'px' : null
        }
      }
    })
  )

  /**
  |--------------------------------------------------------------------------
  | Subscriptions (effect)
  |--------------------------------------------------------------------------
  */
  private dataSourceSub = combineLatest([this.dataSourceOptions$, this.locale$])
    .pipe(withLatestFrom(this.schemas$), takeUntil(this.destroy$))
    .subscribe(([[dataSources, locale], schemas]) => {
      for (let dataSource of dataSources) {
        if (locale) {
          dataSource = {
            ...dataSource,
            settings: {
              ...(dataSource.settings ?? {}),
              language: locale
            } as DataSourceSettings
          }
        }

        // 2. Story 级别的 Schema 合并
        if (schemas?.[dataSource.name]) {
          const schema = schemas?.[dataSource.name]
          dataSource = {
            ...dataSource,
            schema: {
              ...(dataSource.schema ?? {}),
              entitySets: mergeEntitySets(dataSource.schema?.entitySets,
                // 向后兼容，需要重构 dataSource.schema.entitySets
                Object.values(schema).reduce((acc, cur) => {
                  acc[cur.name] = {
                    name: cur.name,
                    entityType: cur,
                  }
                  return acc
                }, {}))
            } as Schema
          }
        }
        this.dsCoreService.registerModel(dataSource)
      }
    })
  // 对于一次性异步任务部分改造成 async await 的方式
  private schemaSub = this.schemas$.pipe(
      filter(nonNullable),
    ).subscribe(async (schemas) => {
      for await(const name of Object.keys(schemas)) {
        const schema = schemas[name]
        const dataSource = await firstValueFrom(this.dsCoreService.getDataSource(name))
        dataSource.setSchema({
          ...dataSource.options.schema,
          entitySets: //mergeEntitySets(dataSource.options.schema?.entitySets,
            // 向后兼容
            Object.values(schema).reduce((acc, cur) => {
              acc[cur.name] = {
                name: cur.name,
                entityType: cur,
              }
              return acc
            }, {}) // )
        })
      }
    })
  // 是否迁移回 storyService 中来, 不通过 core service
  private storyUpdateEventSub = this.coreService.storyUpdateEvent$.pipe(takeUntilDestroyed())
    .subscribe(({ type, dataSettings, parameter, property }) => {
      this.logger?.debug(`[StoryService] add calculation | parameter property`, type, dataSettings, property)
      if (type === 'Parameter') {
        this.upsertParamter({ dataSettings, parameter })
      } else {
        this.addCalculationMeasure({ dataSettings, calculation: property })
      }
    })
  constructor(
    private dsCoreService: NgmDSCoreService,
    private coreService: NxCoreService,
    protected injector: Injector,
    public breakpointObserver: BreakpointObserver,
    @Optional()
    @Inject(NX_STORY_STORE)
    private storyStore?: NxStoryStore,
    @Optional() protected logger?: NGXLogger,
    @Optional() private _snackBar?: MatSnackBar,
    @Optional() private _dialog?: MatDialog
  ) {
    super({ story: {} } as StoryState)
  }

  onSaved() {
    return this.saved$
  }

  setStory(story: Story) {
    this.logger?.debug(`[StoryService] new story`, story)

    this.setState({
      ...this.get(),
      story: cloneDeep(story),
      points: story.points.map((item) => ({
        key: item.key,
        storyPoint: cloneDeep(item)
      }))
    })

    this.dirtyCheckQuery.setHead()
  }

  /**
   * Trigger DirtyCheckQuery to check state dirty then call the actual save method `_saveStory`
   */
  saveStory() {
    this.dirtyCheckQuery.reset()
  }

  refresh(force = false) {
    this.refresh$.next(force)
  }

  onRefresh() {
    return this.refresh$.asObservable()
  }

  readonly setAuthenticated = this.updater((state, isAuthenticated: boolean) => {
    state.isAuthenticated = isAuthenticated
  })

  getTranslation(prefix: string, text: string, params?: Record<string, unknown>) {
    let result: any
    this.translateService.get(prefix, {Default: text, ...params}).subscribe((res) => {
      result = res
    })

    return result
  }

  async getDefaultDataSource() {
    const story = await firstValueFrom(this.story$)
    const defaultModel = story.models?.[0]
    return {
      dataSource: defaultModel?.key,
      entitySet: defaultModel?.cube
    }
  }

  // ================================== Selectors ================================== //
  selectBreakpoint() {
    return this.breakpointObserver.observe([Breakpoints.XSmall, Breakpoints.HandsetPortrait])
  }

  /**
   * 监听某个 Entity Type
   */
  selectEntityType({ dataSource, entitySet }): Observable<EntityType> {
    return this.dsCoreService
      .getDataSource(dataSource)
      .pipe(switchMap((dataSource) => dataSource.selectEntityType(entitySet).pipe(filter(isEntityType))))
  }

  selectWidget(pointId: ID, widgetId: ID) {
    return this.select(
      this.select(this.story$, (story) => story.points?.find((item) => item.id === pointId)),
      (point) => point?.widgets?.find((item) => item.id === widgetId)
    )
  }

  selectPointEvent(pointKey: ID) {
    return this._storyEvent$.pipe(filter(({ key }) => key === pointKey))
  }

  public sendIntent(intent: Intent) {
    this.coreService.sendIntent(intent)
  }

  public onIntent() {
    return this.coreService.onIntent()
  }

  // ================================== Actions ================================== //
  async setCurrentIndex(index: number) {
    const displayPoints = await firstValueFrom(this.displayPoints$)
    this.setCurrentPageKey(displayPoints[index]?.key)
  }

  /**
   * 设置当前页面
   */
  readonly setCurrentPageKey = this.updater((state, key: ID) => {
    state.currentPageKey = key
  })

  /**
   *  @deprecated use newStoryPage ?
   * 
   * 输入页面唯一名称并在服务器端实际创建页面记录, 并将页面添加到当前故事看板中
   *
   * @param type
   * @returns
   */
  private async _createStoryPoint(type: StoryPointType, name: string) {
    const state = this.get()
    const point = await firstValueFrom(this.storyStore.createStoryPoint({
      name,
      type,
      key: uuid(),
      widgets: null,
      storyId: state.story.id,
      index: state.points?.length || 0,
      responsive: type === StoryPointType.Responsive ? defaultResponsive() : null,
      gridOptions: getDefaultPageGrid()
    }))

    this.setStoryPoint(point)
    return point
  }

  /**
   * @deprecated use newStoryPage ?
   * 
   * 创建故事页面
   */
  async createStoryPoint(type: StoryPointType) {
    const name = await firstValueFrom(this._dialog.open(ConfirmUniqueComponent).afterClosed())
    if (name) {
      const page = await this._createStoryPoint(type, name)
      if (page) {
        this.setCurrentPageKey(page.key)
      }
    }
  }

  async newStoryPage(page: Partial<StoryPoint>) {
    const name = page.name || await firstValueFrom(this._dialog.open(ConfirmUniqueComponent).afterClosed())
    if (name) {
      const key = uuid()
      this.addStoryPage({
        ...page,
        type: page.type ?? StoryPointType.Canvas,
        key,
        name,
        storyId: this.story.id
      })
      this.setCurrentPageKey(key)
    }  
  }

  readonly addStoryPage = this.updater((state, input: StoryPoint) => {
    state.points = state.points || []
    state.points.push({
      key: input.key,
      storyPoint: {
        ...input,
        index: input.index ?? state.points.length,
      },
      widgets: input.widgets ?? [],
      fetched: true,
      dirty: true
    })
  })

  /**
   * @deprecated use addStoryPage ?
   * 
   * 添加一个新的页面
   */
  readonly setStoryPoint = this.updater((state, input: StoryPoint) => {
    // 新的页面将 widgets 设置会 null ， 方便判断是否为新加载页面
    input.widgets = null
    const i = state.points?.findIndex(({ storyPoint: point }) => point.id === input.id)
    if (i >= 0) {
      state.points[i] = {
        ...state.points[i],
        storyPoint: input
      }
    } else {
      state.points = state.points || []
      state.points.push({
        key: input.key,
        storyPoint: input
      })
    }

    const j = state.story.points?.findIndex((point) => point.id === input.id)
    if (j >= 0) {
      state.story.points[j] = {
        ...state.story.points[j],
        ...input
      }
    } else {
      state.story.points = state.story.points || []
      state.story.points.push(cloneDeep(input))
    }
  })

  readonly setStoryPointDirty = this.updater((state, { id, dirty }: { id: ID; dirty: boolean }) => {
    const index = state.points.findIndex(({ storyPoint: point }) => point.id === id)
    if (index >= 0) {
      state.points[index] = {
        ...state.points[index],
        dirty
      }
    }
  })

  /**
   * 将 Widget 更新到 story 上
   *
   * @param story
   * @param point
   * @param widget
   * @returns
   */
  _updateStoryWidget(story, point: StoryPoint, widget: StoryWidget) {
    // points 还是以 id 为查找主键
    const i = story.points?.findIndex((item) => item.id === point.id)
    if (i < 0) {
      throw new Error(`Can't index story point '${point.id}'`)
    }

    // widgets 以 id 为主键
    const j = story.points[i].widgets?.findIndex((item) => item.id === widget.id)
    if (j < 0) {
      throw new Error(`Can't found story widget '${widget.id}'`)
    }

    story.points[i].widgets[j] = { ...story.points[i].widgets[j], ...widget }

    return story
  }

  /**
   * Delete story point by key
   */
  readonly deleteStoryPoint = this.updater((state, key: ID) => {
    state.points = state.points.filter((pointState) => pointState.key !== key)
  })

  /**
   * Set the removed flag of a story point
   */
  readonly _removeStoryPoint = this.updater((state, key: ID) => {
    const index = state.points.findIndex((pointState) => pointState.key === key)
    if (index > -1) {
      if (state.points[index].storyPoint.id) {
        state.points[index].removed = true
      } else {
        state.points.splice(index, 1)
      }
    }
  })

  /**
   * Remove a story point by key
   * 
   * @param key 
   */
  async removeStoryPoint(key: string) {
    const displayPoints = await firstValueFrom(this.displayPoints$)
    this._removeStoryPoint(key)
    const index = displayPoints.findIndex((item) => item.key === key)
    this.patchState({
      currentPageKey: displayPoints[index > 0 ? index - 1 : 1]?.key
    })
  }

  async hideStoryPage(key: string) {
    const displayPoints = await firstValueFrom(this.displayPoints$)

    this.toggleStoryPointHidden(key)

    const index = displayPoints.findIndex((item) => item.key === key)
    this.patchState({
      currentPageKey: displayPoints[index > 0 ? index - 1 : 1]?.key
    })
  }

  readonly toggleStoryPointHidden = this.updater((state, key: string) => {
    const storyPoint = state.points.find((item) => item.key === key)
    if (storyPoint) {
      storyPoint.storyPoint.hidden = !storyPoint.storyPoint.hidden
    }
  })

  readonly setCurrentWidget = this.updater((state, widget: StoryWidget) => {
    state.currentWidget = widget
  })

  async createStoryWidget(event: Partial<StoryWidget>) {
    const currentPageKey = await firstValueFrom(this.currentPageKey$)

    this._storyEvent$.next({
      key: currentPageKey,
      type: StoryEventType.CREATE_WIDGET,
      data: {
        ...event,
        dataSettings: await this.getDefaultDataSource()
      }
    })
  }

  readonly copyWidget = this.updater((state, widget?: StoryWidget) => {
    const currentWidget: StoryWidget = cloneDeep(widget ?? state.currentWidget)
    state.copySelectedWidget = {
      ...currentWidget,
      position: {
        ...currentWidget.position,
        x: 0,
        y: 0
      }
    }
  })

  readonly duplicateWidget = this.updater((state) => {
    this.copyTo({ pointKey: state.currentPageKey })
  })

  readonly clearCopy = this.updater((state) => {
    state.copySelectedWidget = null
  })

  readonly setEditable = this.updater((state, editable: boolean) => {
    state.editable = editable
  })

  /**
   * 保存故事: 1. 故事变化; 2. 创建删除故事点;
   * 其他的变化由 StoryPoint 服务进行保存.
   * 
   * @param pristine 
   * @param current 
   * @returns 
   */
  private _saveStory(pristine: Story, current: Story): Observable<any> {
    
    const updates: Observable<void>[] = []
    // update story
    if (!isEqual({ ...pristine, points: [] }, { ...current, points: [] })) {
      updates.push(this.storyStore.updateStory(current))
    }

    this.get((state) => state.points).filter((state) => state.removed && state.storyPoint.id).forEach((state) => {
      // delete point
      updates.push(
        this.storyStore.removeStoryPoint(pristine.id, state.storyPoint.id).pipe(
          tap({
            next: () => {
              // Delete story point in local state
              this.deleteStoryPoint(state.key)
            },
            error: (error) => {
              this._snackBar.open('删除失败', error.status, {
                duration: 2000
              })
            }
          })
        )
      )
    })

    if (isNotEmpty(updates)) {
      return combineLatest(updates)
    }
    
    return of(true)
  }

  // actions for calculation measure
  readonly addCalculationMeasure = this.updater(
    (
      state,
      {
        dataSettings,
        calculation,
        entityCaption
      }: { dataSettings: DataSettings; calculation: CalculationProperty & { options?: any }; entityCaption?: string }
    ) => {
      // const schema = (state.story.schema = state.story.schema || { name: null, entitySets: {} })
      const properties = getOrInitEntityType(state, dataSettings.dataSource, dataSettings.entitySet, entityCaption).properties

      const originName = findKey(properties, (o) => o.__id__ === calculation.__id__)
      if (originName) {
        delete properties[originName]
      }

      // 是否都是 measure 有没有其他情况, Calculated Set 是否在此?
      properties[calculation.name] = {
        ...omit(calculation, 'options'),
        role: AggregationRole.measure,
        dataType: 'number'
      }

      const property = properties[calculation.name]

      if (isMeasureControlProperty(calculation)) {
        properties[calculation.name] = {
          ...omit(calculation, 'options'),
          role: AggregationRole.measure,
          dataType: 'number',
          // 默认第一个 Measure
          value: calculation.value ?? calculation.availableMembers[0]?.value
        } as MeasureControlProperty

        // New calculation measure control to create input control for it
        if (!originName) {
          this.createMeasureControlWidget({ dataSettings, name: calculation.name })
        }
        
      }

      if (isRestrictedMeasureProperty(property)) {
        // Create Input Control for RestrictedMeasure
        property.dimensions?.forEach((dimension) => {
          if (dimension.name && !originName) {
            // create dimension input control
            this.createInputControlWidget({
              dataSource: dataSettings.dataSource,
              entitySet: dataSettings.entitySet,
              dimension: dimension
            })
          }
        })
      }
    }
  )

  /**
   * 更新计算度量属性, 常被用在诸如 Measure Input Control 等字段
   */
  readonly updateCalculationMeasure = this.updater(
    (
      state,
      {
        dataSettings,
        calculation,
        entityCaption
      }: { dataSettings: DataSettings; calculation: Partial<CalculationProperty>; entityCaption?: string }
    ) => {
      // Find the measure entity position in story schema
      const properties = getOrInitEntityType(state, dataSettings.dataSource, dataSettings.entitySet, entityCaption).properties

      const originName = findKey(properties, (o) => o.__id__ === calculation.__id__)
      let originProperty = {} as Property
      if (originName) {
        originProperty = properties[originName]
        delete properties[originName]
      }
      properties[calculation.name ?? originProperty.name] = {
        ...originProperty,
        ...calculation
      } as Property
    }
  )

  /**
   * 如何安全地删除计算成员， 保证使用到的地方都被提醒到？
   */
  readonly removeCalculation = this.updater((state, {dataSettings, name}: {dataSettings: DataSettings, name: string;}) => {
    // Find the measure entity position in story schema
    const properties = getOrInitEntityType(state, dataSettings.dataSource, dataSettings.entitySet).properties
    delete properties[name]
  })

  /**
   * 更新或者创建 Entity Parameter
   */
  readonly upsertParamter = this.updater(
    (state, { dataSettings, parameter, entityCaption }: { dataSettings: DataSettings; parameter: Partial<ParameterProperty>; entityCaption?: string }) => {
      const parameters = getOrInitEntityParameters(state, dataSettings.dataSource, dataSettings.entitySet, entityCaption)
      const key = findKey(parameters, (o) => o.__id__ === parameter.__id__)
      let origin = {} as ParameterProperty
      if (key) {
        origin = parameters[key]
        delete parameters[key]
      }
      parameters[parameter.name ?? origin.name] = {
        ...origin,
        ...parameter
      }

      if (!key) {
        this.createInputControlWidget({
          ...dataSettings,
          dimension: {
            dimension: parameter.name
          }
        })
      }
    }
  )

  readonly removeEntityParameter = this.updater((state, {dataSource, entity, parameter}: {dataSource: string, entity: string, parameter: string;}) => {
    const parameters = getOrInitEntityParameters(state, dataSource, entity)
    const key = findKey(parameters, (o) => o.name === parameter)
    if (key) {
      delete parameters[key]
    }
  })

  /**
   * 创建 dimension 的 Input Control
   */
  readonly createInputControlWidget = this.updater(
    (state, { dataSource, entitySet, dimension }: DataSettings) => {
      const storyPoint = state.points.find((item) => item.key === state.currentPageKey)
      storyPoint.widgets.push({
        key: uuid(),
        storyId: state.story.id,
        pointId: storyPoint.storyPoint.id,
        name: dimension.name,
        title: dimension.name,
        component: WidgetComponentType.InputControl,
        position: { x: 0, y: 0, ...WIDGET_INIT_POSITION },
        dataSettings: {
          dataSource,
          entitySet,
          dimension
        },
        options: {
          dimension
        }
      } as StoryWidget)
    }
  )

  getCurrentWidget(widgetKey?: string) {
    const state = this.get()
    let widget: StoryWidget
    if (widgetKey) {
      widget = findStoryWidget(state, widgetKey)
      if (!widget) {
        throw new Error(`Can't found widget '${widgetKey}'`)
      }
    } else if(state.currentWidget) {
      widget = state.currentWidget
    } else {
      throw new Error(`Please select an widget!`)
    }
    return widget
  }

  copyTo(orign: { name?: string; widgetKey?: ID; pointKey: ID }) {
    const { name, pointKey, widgetKey } = orign
    const widget: StoryWidget = this.getCurrentWidget(widgetKey)

    this.pasteWidget({ widget, pointKey, name })

    this.setCurrentPageKey(pointKey)
  }

  async copyToNew(type: StoryPointType, widgetKey?: ID) {
    const name = await firstValueFrom(this._dialog.open(ConfirmUniqueComponent).afterClosed())
    if (name) {
      const point = await this._createStoryPoint(type, name)
      if (point) {
        this.copyTo({ pointKey: point.key, widgetKey })
      }
    }
  }

  /**
   * Move widget to another page
   */
  public readonly moveWidgetTo = this.updater((state, params: {widget: {pointKey: ID, key: ID}, pointKey: ID}) => {
    const { widget, pointKey } = params
    const toPage = state.points.find((item) => item.key === pointKey)
    const fromPage = state.points.find((item) => item.key === widget.pointKey)
    if (fromPage && toPage) {
      const index = fromPage.widgets.findIndex((item) => item.key === widget.key)
      if (index > -1) {
        const widgets = fromPage.widgets.splice(index, 1)
        toPage.pasteWidgets = toPage.pasteWidgets ?? []
        toPage.pasteWidgets.push({
          ...widgets[0],
          position: {
            ...widgets[0].position,
            x: 0,
            y: 0
          }
        })
      }
    }
  })

  /**
   * Move widget to new page
   * 
   * @param pointKey 
   * @param widgetKey 
   * @param type 
   */
  async moveWidgetToNew(pointKey: ID, widgetKey: ID, type: StoryPointType) {
    const name = await firstValueFrom(this._dialog.open(ConfirmUniqueComponent).afterClosed())
    if (name) {
      const point = await this._createStoryPoint(type, name)
      if (point) {
        this.moveWidgetTo({ pointKey: point.key, widget: {pointKey, key: widgetKey} })
      }
    }
  }

  readonly duplicateStoryPoint = this.updater((state, key: string) => {
    const index = state.points.findIndex((item) => item.key === key)
    const storyPointState = state.points[index]
    if (storyPointState) {
      const newStoryPointState = cloneDeep(storyPointState)
      newStoryPointState.key = uuid()
      newStoryPointState.storyPoint.key = newStoryPointState.key
      newStoryPointState.storyPoint.id = null
      newStoryPointState.widgets?.forEach((widget) => {
        widget.id = null
        widget.pointId = null
      })
      newStoryPointState.dirty = true
      state.points.splice(index + 1, 0, newStoryPointState)
    }
  })

  async removeCurrentWidget() {
    const currentPageKey = await firstValueFrom(this.currentPageKey$)
    const currentWidget = await firstValueFrom(this.currentWidget$)

    this._storyEvent$.next({
      key: currentPageKey,
      type: StoryEventType.REMOVE_WIDGET,
      data: currentWidget?.key
    })
  }

  /**
   * 移动页面， 左一个、右一个、第一个、最后一个
   */
  readonly move = this.updater((state, { direction, key }: { direction: MoveDirection; key: ID }) => {
    const points = sortBy(state.points, (o) => o.storyPoint.index)
    const index = points.findIndex((item) => item.key === key)
    if (index > -1) {
      let swapTarget
      switch (direction) {
        case 'right':
          swapTarget = points[index + 1]
          if (swapTarget) {
            points[index + 1] = points[index]
            points[index] = swapTarget
          }
          break
        case 'left':
          swapTarget = points[index - 1]
          if (swapTarget) {
            points[index - 1] = points[index]
            points[index] = swapTarget
          }
          break
        case 'first':
          swapTarget = points.splice(index, 1)
          points.splice(0, 0, ...swapTarget)
          break
        case 'last':
          swapTarget = points.splice(index, 1)
          points.push(...swapTarget)
          break
      }

      points.forEach((item, i) => {
        if (item.storyPoint) {
          item.storyPoint.index = i
        } else {
          // console.warn(cloneDeep(item))
        }
      })
    }
  })

  async saveStoryPoint(key: string) {
    this._storyEvent$.next({
      key,
      type: StoryEventType.SAVE,
      data: {
      }
    })
  }

  readonly pasteWidget = this.updater(
    (state, { name, widget, pointKey }: { name?: string; widget?: StoryWidget; pointKey?: ID }) => {
      const point = pointKey
        ? state.points.find((item) => item.key === pointKey)
        : state.points.find((item) => item.key === state.currentPageKey)

      widget = cloneDeep(widget || state.copySelectedWidget)

      if (name) {
        widget.name = name
        widget.title = name
      }
      widget.id = null
      widget.key = uuid()
      widget.storyId = state.story.id
      widget.pointId = point.storyPoint.id
      widget.position = { ...widget.position, x: 0, y: 0 }

      if (isNil(point.widgets)) {
        point.pasteWidgets = point.pasteWidgets ?? []
        point.pasteWidgets.push(widget)
      } else {
        point.widgets.push(widget)
      }
    }
  )

  /**
   * 创建度量控制器
   */
  readonly createMeasureControlWidget = this.updater((state, { dataSettings, name }: Partial<StoryWidget>) => {
    // Get current page state
    const storyPoint = state.points.find((item) => item.key === state.currentPageKey)
    storyPoint.widgets.push({
      key: uuid(),
      storyId: state.story.id,
      pointId: storyPoint.storyPoint.id,
      name,
      title: name,
      component: WidgetComponentType.InputControl,
      position: { x: 0, y: 0, ...WIDGET_INIT_POSITION },
      dataSettings,
      options: {
        dimension: {
          dimension: C_MEASURES,
          measure: name
        }
      }
    } as StoryWidget)
  })

  // Gesture Actions
  async swipe(dir: 'left' | 'right', loop = false) {
    const currentIndex = await firstValueFrom(this.currentIndex$)
    const displayPoints = await firstValueFrom(this.displayPoints$)
    let index = 0
    if (dir === 'left') {
      index = Math.max(currentIndex - 1, 0)
      if (index === currentIndex) {
        index = loop ? displayPoints.length - 1 : currentIndex
      }
    } else {
      index = Math.min(currentIndex + 1, displayPoints.length - 1)
      if (index === currentIndex) {
        index = loop ? 0 : currentIndex
      }
    }
    this.setCurrentPageKey(displayPoints[index]?.key)
  }

  // Updaters for copilot actions
  readonly updateStory = this.updater((state, story: Partial<Story>) => {
    state.story = {
      ...state.story,
      ...story
    }
  })

  readonly updateStoryFilterBar = this.updater((state, filterBar: Partial<StoryFilterBar>) => {
    state.story.filterBar = {
      ...(state.story.filterBar ?? {}),
      ...filterBar
    }
  })

  readonly updateStoryOptions = this.updater((state, options: Partial<StoryOptions>) => {
    state.story.options = {
      ...(state.story.options || {}),
      ...options
    }
  })

  readonly updateStoryPreferences = this.updater((state, preferences: Partial<StoryPreferences>) => {
    state.story.options = state.story.options ?? {}
    state.story.options.preferences = {
      ...(state.story.options?.preferences || {}),
      ...preferences
    }
  })
  
  readonly zoomIn = this.updater((state) => {
    state.story.options = {
      ...(state.story.options ?? {}),
      scale: (state.story.options?.scale ?? 100) + 10
    }
  })

  readonly zoomOut = this.updater((state) => {
    state.story.options = {
      ...(state.story.options ?? {}),
      scale: (state.story.options?.scale ?? 100) - 10
    }
  })

  /**
   * Apply template to story
   */
  readonly applyTemplate = this.updater((state, template: IStoryTemplate) => {
    state.story.templateId = template.id
    // Apply theme
    state.story.options = assignDeepOmitBlank(state.story.options, template?.options?.story?.options, Number.MAX_SAFE_INTEGER)
    // Apply template
    if (template.type === StoryTemplateType.Template) {
      // Clear all story points
      state.story.points = []

      // create story points states
      state.points = template.options.pages?.map((item) => {
        return {
          fetched: true,
          dirty: true,
          key: item.key,
          storyPoint: {
            ...item,
            storyId: state.story.id,
          },
          widgets: item.widgets
        } as StoryPointState
      })

      this.setCurrentPageKey(state.points[0]?.key)
    }

  })

  readonly setCreatingWidget = this.updater((state, creatingWidget: Partial<StoryWidget>) => {
    state.creatingWidget = creatingWidget
  })

  readonly updateStoryStyles = this.updater((state, styles: cssStyle) => {
    state.story.options = {
      ...(state.story.options ?? {}),
      preferences: {
        ...(state.story.options?.preferences ?? {} as StoryPreferences),
        story: {
          ...(state.story.options?.preferences?.story ?? {} as StoryPreferences['story']),
          styling: {
            ...(state.story.options?.preferences?.story?.styling ?? {}),
            ...styles
          }
        }
      }
    }
  })

  readonly updateWidgetStyles = this.updater((state, styles: cssStyle) => {
    state.story.options = {
      ...(state.story.options ?? {}),
      preferences: {
        ...(state.story.options?.preferences ?? {} as StoryPreferences),
        widget: {
          ...(state.story.options?.preferences?.widget ?? {} as StoryPreferences['widget']),
          ...styles
        }
      }
    }
  })

  readonly updateStoryPointStyles = this.updater((state, styles: cssStyle) => {
    const currentPageKey = state.currentPageKey
    const currentPageIndex = state.points.findIndex((item) => item.key === currentPageKey)
    state.points[currentPageIndex].storyPoint = {
      ...state.points[currentPageIndex].storyPoint,
      styling: {
        ...(state.points[currentPageIndex].storyPoint?.styling ?? {} as StoryPoint['styling']),
        canvas: {
          ...(state.points[currentPageIndex].storyPoint?.styling?.canvas ?? {}),
          ...styles
        }
      }
    }
  })

  /**
   * @deprecated 迁移到 widget 内
   */
  updateStoryWidgetChartOptions(key: string, styles: cssStyle) {
    const state = this.get()
    if (!state.currentWidget?.key) {
      throw new Error(`Please select an widget!`)
    }

    (this.updater((state, styles: cssStyle) => {
      const widget = findStoryWidget(state, state.currentWidget.key) as any
      widget.chartOptions = {
        ...(widget.chartOptions ?? {}),
        [key]: {
          ...(widget.chartOptions?.[key] ?? {}),
          ...styles,
        },
        [`__show${key}__`]: true
      } as any
    }))(styles)
  }

  
}

function defaultResponsive() {
  return {
    key: uuid(),
    type: 0,
    direction: 'column',
    styles: {
      'max-width': '100%'
    },
    children: [
      {
        key: uuid(),
        type: 0,
        direction: 'row',
        styles: {
          'max-width': '100%'
        },
        children: [
          {
            key: uuid(),
            type: 0,
            direction: 'row',
            styles: {
              'flex-direction': 'row',
              'flex-wrap': 'wrap',
              'align-content': 'flex-start',
              'flex-basis': '50%',
              'max-width': '50%'
            }
          },
          {
            key: uuid(),
            type: 0,
            styles: {
              'flex-direction': 'row',
              'flex-wrap': 'wrap',
              'flex-basis': '50%',
              'max-width': '50%'
            }
          }
        ]
      },
      {
        key: uuid(),
        type: 0,
        direction: 'row',
        styles: {
          'flex-direction': 'row',
          'flex-wrap': 'wrap'
        }
      }
    ]
  } as FlexLayout
}

export function findStoryWidget(state: StoryState, key: ID) {
  let widget: StoryWidget
  state.points.find((point) => {
    return point.widgets?.find((item) => {
      if (item.key === key) {
        widget = item
        return true
      }
      return false
    })
  })

  return widget
}

function getOrInitEntityParameters(state: StoryState, dataSource: string, entity: string, caption?: string) {
  const entityType = getOrInitEntityType(state, dataSource, entity, caption)
  entityType.parameters = entityType.parameters ?? {}
  return entityType.parameters
}

function getOrInitEntityType(state: StoryState, dataSource: string, entity: string, caption?: string) {
  const schemas = state.story.schemas = state.story.schemas ?? {}
  const schema = schemas[dataSource] = schemas[dataSource] ?? {}
  const entityType = schema[entity] = schema[entity] ?? {
    name: entity,
    caption: caption,
    properties: {}
  }
  return entityType
}
