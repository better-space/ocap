import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal
} from '@angular/core'
import { MatMenuTrigger } from '@angular/material/menu'
import { csvDownload, DisplayDensity, ISelectOption, NgmAppearance } from '@metad/ocap-angular/core'
import {
  ChartAnnotation,
  ChartOptions,
  ChartSettings,
  ChartType,
  DataSettings,
  Dimension,
  Drill,
  getEntityHierarchy,
  getEntityLevel,
  getEntityProperty,
  getPropertyHierarchy,
  getPropertyName,
  IChartSelectedEvent,
  isAdvancedFilter,
  isEqual,
  ISlicer,
  isSlicer,
  nonNullable,
  omit,
  parseDimension,
  pick,
  Property,
  putFilter,
  slicerAsString
} from '@metad/ocap-core'
import { EChartEngineEvent, SmartEChartEngine } from '@metad/ocap-echarts'
import { ComponentStore } from '@metad/store'
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy'
import { ECharts } from 'echarts/core'
import { assign, cloneDeep, findIndex, isEmpty, isNil } from 'lodash-es'
import { BehaviorSubject, combineLatest, Observable } from 'rxjs'
import { distinctUntilChanged, filter, map, pairwise, shareReplay, skip, startWith, tap, withLatestFrom } from 'rxjs/operators'
import { Step } from '@metad/ocap-angular/common'
import { AnalyticalCardService } from './analytical-card.service'


export interface DrillLevel {
  // 父级维度， 从哪个维度下钻来的
  parent: Dimension
  dimension: Dimension

  // level?: number
  slicer: ISlicer

  value?: any
  text?: string
  active?: boolean
}

export interface AnalyticalCardOptions {
  /**
   * Hide elements in this component
   */
  hideHeader?: boolean
  hideRefresh?: boolean
  hideLoading?: boolean
  hideScreenshot?: boolean
  hideDataDownload?: boolean
  disableContextMenu?: boolean
  /**
   * Enable realtinme linked analysis: output slicers immediately when data selected 
   */
  realtimeLinked?: boolean
}

export interface AnalyticalCardState {
  dataSettings: DataSettings
  slicers: ISlicer[]

  // 已下钻维度
  drilledDimensions: Array<DrillLevel>
  // 在已下钻维度列表中又选中部分维度
  selectedDrilledDimensions: Array<DrillLevel>
  // 当前选中的 Slicer
  selectedSlicers: ISlicer[]
}

@UntilDestroy({checkProperties: true})
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngm-analytical-card',
  templateUrl: './analytical-card.component.html',
  styleUrls: ['./analytical-card.component.scss'],
  providers: [AnalyticalCardService],
  host: {
    '[class.ngm-density__compact]': `!displayDensity||displayDensity==='compact'`,
    '[class.ngm-density__cosy]': `displayDensity==='cosy'`
  }
})
export class AnalyticalCardComponent extends ComponentStore<AnalyticalCardState> implements OnInit, OnChanges, OnDestroy {
  DisplayDensity = DisplayDensity

  private readonly businessService = inject(AnalyticalCardService)
  private readonly _ngZone = inject(NgZone)
  private readonly _cdr = inject(ChangeDetectorRef)

  private echartsEngine = new SmartEChartEngine()
  private _slicersChanging$ = new BehaviorSubject<ISlicer[]>(null)

  @HostBinding('class.ngm-analytical-card') _isAnalyticalCard = true

  @Input() title: string
  @Input() appearance: NgmAppearance
  /**
   * Data Settings
   */
  @Input() get dataSettings(): DataSettings {
    return this.get((state) => state.dataSettings)
  }
  set dataSettings(value) {
    this._dataSettings.set(value)
    this.patchState({
      dataSettings: value
    })
  }
  private _dataSettings$ = this.select((state) => state.dataSettings)
  public _dataSettings = signal<DataSettings>(null)

  @Input() chartSettings: ChartSettings
  @Input() chartOptions: ChartOptions

  @Input() options: AnalyticalCardOptions
  @Input() get slicers() {
    return this.get((state) => state.slicers)
  }
  set slicers(value) {
    this.patchState({slicers: value})
  }

  /**
   * @deprecated use slicersChanging
   */
  @Output() slicersChange = new EventEmitter<ISlicer[]>()
  /**
   * To avoid being confused with slicers & slicersChange
   */
  @Output() slicersChanging = this._slicersChanging$.pipe(skip(1), distinctUntilChanged(isEqual))
  @Output() chartClick = this.echartsEngine.chartClick$
  @Output() chartHighlight = this.echartsEngine.chartHighlight$
  @Output() chartContextMenu = this.echartsEngine.chartContextMenu$
  @Output() explain = new EventEmitter<any[]>()

  @ViewChild('contextMenuTrigger') contextMenu: MatMenuTrigger
  contextMenuPosition = { x: '0px', y: '0px' }

  get displayDensity() {
    return this.appearance?.displayDensity
  }

  get chartType() {
    return this.dataSettings?.chartAnnotation?.chartType
  }
  set chartType(chartType: ChartType) {
    this.patchState({
      dataSettings: {
        ...this.dataSettings,
        chartAnnotation: {
          ...(this.dataSettings.chartAnnotation ?? {}),
          chartType
        } as ChartAnnotation
      }
    })
  }

  // Inner states
  // The final option for ECharts instance
  readonly options$: Observable<any> = this.echartsEngine.selectChartOptions().pipe(
    filter(({ error }) => {
      if (error) {
        this.error$.next(error)
      } else {
        this.error$.next(null)
      }
      return !error
    }),
    map(({ options }) => options),
    // 为初始化 ECharts 实例，然后传递给 SmartEChartEngine 以便进行事件绑定
    startWith({}),
  ) as any

  public readonly isLoading$ = this.businessService.loading$
  public readonly error$ = new BehaviorSubject<string>(null)
  private _empty$ = new BehaviorSubject<boolean>(false)
  set empty(value: boolean) {
    this._empty$.next(value)
  }
  public readonly empty$ = combineLatest([this._empty$, this.error$]).pipe(map(([empty, error]) => empty && !error))

  // For drill down
  readonly selectedDrilledDimensions$ = this.select((state) => state.selectedDrilledDimensions)
  readonly selectedSlicers$ = this.select((state) => state.selectedSlicers)
  readonly drilledDimensions$ = this.select((state) => state.drilledDimensions)
  readonly breadcrumbs$ = this.drilledDimensions$.pipe(
    map((drills) => {
      return drills?.map((item) => ({
        value: item,
        label: item.slicer.members[0].label || (item.slicer.members[0].value as string),
        active: true
      } as Step))
    })
  )

  public readonly dillSlicers$ = this.selectedSlicers$.pipe(
    map((slicers) => {
      if (isAdvancedFilter(slicers?.[0])) {
        return slicers[0].children
      }
      return slicers
    }),
    withLatestFrom(this.businessService.selectEntityType()),
    map(([slicers, entityType]) => {
      return slicers?.map((slicer) => {
        const property = getEntityProperty(entityType, slicer.dimension)
        return {
          value: slicer,
          label: (property.caption || property.name) + ':' + slicerAsString(slicer)
        } as ISelectOption<ISlicer>
      })
    })
  )

  /**
   * 维度下钻
   * 1. 来自于 PresentationVariant 中的 groupBy
   * 2. disable 已被选中的下钻维度
   */
  public readonly drillDimensions$ = this.select(
    this.businessService.presentationVariant$,
    this.businessService.selectEntityType(),
    this.selectedDrilledDimensions$,
    (presentationVariant, entityType, selectedDrilledDimensions) => {
      return presentationVariant?.groupBy?.map((item: Dimension) => ({
        dimension: item,
        property: getEntityProperty(entityType, item),
        disabled: !!selectedDrilledDimensions?.find(
          (selected) => getPropertyName(selected.dimension) === getPropertyName(item)
        )
      }))
    }
  )

  public readonly canDrillDimensions$ = this.drillDimensions$.pipe(map((drillDimensions) => !isEmpty(drillDimensions)))

  /**
   * 最终的数据设置
   */
  readonly dataSettings$ = combineLatest([
    this._dataSettings$,
    this.select((state) => state.slicers),
    this.selectedDrilledDimensions$
  ]).pipe(
    filter(([dataSettings]) => !isNil(dataSettings)),
    map(([dataSettings, slicers, selectedHierachyLevels]) => {
      const chartAnnotation = dataSettings.chartAnnotation
      const _selectOptions = (dataSettings.selectionVariant?.selectOptions ?? []) as ISlicer[]
      const selectionVariant = {
        ...(dataSettings.selectionVariant ?? {}),
        selectOptions: slicers?.reduce((slicers, item) => putFilter(slicers, item), _selectOptions) ?? _selectOptions
      }

      if (isEmpty(selectedHierachyLevels)) {
        return {
          ...dataSettings,
          selectionVariant
        }
      }

      // 每次都 clone chartAnnotation 防止重复修改
      const _chartAnnotation = cloneDeep(chartAnnotation)
      
      const dimensions = _chartAnnotation.dimensions
      selectedHierachyLevels.forEach((item) => {
        const index = findIndex(dimensions, (o) => getPropertyName(o) === getPropertyName(item.parent))
        dimensions.splice(index, 1, { // @todo
          ...dimensions[index],
          ...item.dimension
        })
      })
      const selectOptions = selectedHierachyLevels.reduce((slicers, item) => putFilter(slicers, item.slicer), selectionVariant.selectOptions)

      return assign(cloneDeep(dataSettings), {
        chartAnnotation: {
          ..._chartAnnotation,
          dimensions
        },
        selectionVariant: {
          ...selectionVariant,
          selectOptions
        }
      })
    }),
    shareReplay(1)
  )
  /**
   * 1. TODO 暂时取 chartAnnotation 中所有的 dimensions 维度
   * 2. disable 级别数小于已选中层级的维度
   */
  public readonly drillLevels$ = combineLatest([
    this.dataSettings$,
    this.businessService.selectEntityType(),
    this.select((state) => state.selectedSlicers)
  ]).pipe(
    map(([dataSettings, entityType, selectedSlicers]) => {
      const chartAnnotation = dataSettings.chartAnnotation
      return chartAnnotation.dimensions
        .map((dimension) => {
          return {
            dimension,
            hierarchy: getEntityHierarchy(entityType, dimension)
          }
        })
        .filter(({ hierarchy }) => hierarchy?.levels)
        .map(({ dimension, hierarchy }) => {
          const selectedSlicer = selectedSlicers[0]

          const slicer = isAdvancedFilter(selectedSlicer)
            ? selectedSlicer.children?.find((slicer) => slicer.dimension.dimension === dimension.dimension)
            : selectedSlicer

          if (slicer?.dimension?.dimension !== dimension.dimension) {
            return {
              property: hierarchy,
              slicer: null,
            }
          }

          const slicerLevel = getEntityLevel(entityType, slicer?.dimension)
          return {
            slicer,
            property: hierarchy,
            levels: hierarchy.levels.map((level) => ({
              property: level,
              disabled: level.levelNumber <= (slicerLevel?.levelNumber || 0)
            })),
            slicerCaption: slicerAsString(slicer)
          }
        })
        .filter(({ slicer }) => nonNullable(slicer))
    }),
    untilDestroyed(this),
    shareReplay(1)
  )
  public readonly canDrillLevels$ = this.drillLevels$.pipe(map((levels) => !isEmpty(levels)))
  /**
   * 默认下钻行为: 如果图形为多维度, 则默认取第一个维度
   */
  public readonly dilldown$ = this.selectedSlicers$.pipe(
    map((selectedSlicers) => {
      const first = selectedSlicers[0]
      return isAdvancedFilter(first) ? first.children[0] : isSlicer(first) ? first : null
    })
  )

  /**
  |--------------------------------------------------------------------------
  | Subscriptions (effect)
  |--------------------------------------------------------------------------
  */
  // Listener for dataSettings changed
  private _dataSettingsSub = this.dataSettings$
    .pipe(
      filter(Boolean),
      startWith(null),
      pairwise(),
    )
    .subscribe(([a, b]) => {
      if (
        isEqual(
          {
            ...(a ?? {}),
            chartAnnotation: omit(a?.chartAnnotation, 'chartType')
          }, {
            ...b,
            chartAnnotation: omit(b.chartAnnotation, 'chartType')
          }
        )
      ) {
        this.echartsEngine.chartAnnotation = b?.chartAnnotation
      }
      this.businessService.dataSettings = b
    })

  // Listeners for explain logic
  private _explainSub = combineLatest([
      this.dataSettings$,
      this.businessService.selectResult(),
      this.echartsEngine.selectChartOptions().pipe(startWith(null))
    ]).subscribe(([dataSettings, queryReturn, chartOptions]) => {
      this.explain.emit([
        dataSettings, queryReturn, chartOptions
      ])
    })

  // Clear slicers changed output when ECharts refresh
  private _echartsOptionSub = this.echartsEngine.selectChartOptions().subscribe(() => {
    this.openContextMenu(null)
  })

  // Listeners for ECharts events
  // ECharts ContextMenu event
  private _contextMenuSub = this.echartsEngine.chartContextMenu$.subscribe((event: EChartEngineEvent) => {
    event.event.stopPropagation()
    event.event.preventDefault()

    // Unselect selected data item in series component
    this.echartsEngine.dispatchAction({
      ...pick(event, 'seriesIndex', 'seriesId', 'seriesName', 'dataIndex', 'name'),
      type: 'unselect',
    })

    // this._ngZone.run(() => {
    //   this.openContextMenu(event.slicers, event.event)
    // })
  })

  // ECharts selecchanged event
  private _selectChangedSub = this.echartsEngine.selectChanged$.subscribe((event: IChartSelectedEvent) => {
    this._ngZone.run(() => {
      this.openContextMenu(event.slicers, event.event)
    })
  })

  constructor() {
    super({} as AnalyticalCardState)
  }

  ngOnInit(): void {
    this.businessService
      .selectResult()
      .pipe(
        filter(({ error }) => {
          if (error) {
            this.error$.next(error)
          } else {
            this.error$.next(null)
          }
          return !error
        }),
        withLatestFrom(this.businessService.chartAnnotation$),
        untilDestroyed(this)
      )
      .subscribe(([result, chartAnnotation]) => {
        this.empty = !result.data?.length
        this.echartsEngine.data = result
        this.echartsEngine.chartAnnotation = chartAnnotation
      })

    this.businessService
      .onAfterServiceInit()
      .pipe(untilDestroyed(this))
      .subscribe(async () => {
        this.echartsEngine.entityType = await this.businessService.getEntityType()
        this.refresh()
      })
    
  }

  ngOnChanges({ dataSettings, chartSettings, chartOptions }: SimpleChanges) {
    if (dataSettings || chartSettings || chartOptions) {
      this.error$.next(null)
    }

    if (chartSettings) {
      this.echartsEngine.settings = chartSettings.currentValue
    }

    if (chartOptions) {
      this.echartsEngine.options = chartOptions.currentValue
    }
  }

  /**
   * 刷新数据
   * 
   * @param force 强制刷新
   */
  refresh(force?: boolean) {
    this.businessService.refresh(force)
  }

  onChartInit(event: ECharts) {
    this.echartsEngine.echarts = event
  }

  onOptionsError(event: Error) {
    this.error$.next(event.message)
    this.echartsEngine.echarts.dispose()
    this._cdr.detectChanges()
  }

  openContextMenu(slicers: ISlicer[], event?) {
    event?.stopPropagation()
    event?.preventDefault()

    // 设置当前选中过滤器
    this.patchState({ selectedSlicers: slicers })

    // 弹出菜单坐标
    if (event?.type === 'touchend') {
      this.contextMenuPosition.x = event.zrX + 50 + 'px'
      this.contextMenuPosition.y = event.zrY + 'px'
    } else if(event) {
      this.contextMenuPosition.x = event.offsetX + 50 + 'px'
      this.contextMenuPosition.y = event.offsetY + 'px'
    }

    this.contextMenu.menuData = { slicers }

    if (isEmpty(slicers)) {
      this.contextMenu.closeMenu()
      this.onLinkAnalysis([])
    } else {
      if (!this.options?.disableContextMenu) {
        this.contextMenu.openMenu()
      }
      
      if (this.options?.realtimeLinked) {
        this.onLinkAnalysis(slicers)
      }
    }
  }

  /**
   * Linked analysis, output selected slicers on chart
   * 
   * @param slicers 
   */
  onLinkAnalysis(slicers: ISlicer[]) {
    this.slicersChange.emit(slicers)
    this._slicersChanging$.next(slicers)
  }
  
  readonly drill = this.updater((state, drillLevel: DrillLevel) => {
    state.selectedDrilledDimensions = state.selectedDrilledDimensions || []
    state.drilledDimensions = state.drilledDimensions || []
    state.drilledDimensions = [...state.selectedDrilledDimensions, drillLevel]

    state.selectedDrilledDimensions = [...state.drilledDimensions]
  })

  readonly reselectDrill = this.updater((state, drillLevels: any[]) => {
    state.selectedDrilledDimensions = drillLevels.map(({ value }) => value)
  })

  readonly drillLevel = this.effect((origin$: Observable<{ slicer: ISlicer; property: Property }>) => {
    return origin$.pipe(
      withLatestFrom(this.businessService.selectEntityType()),
      tap(([{ slicer, property }, entityType]) => {
        if (isAdvancedFilter(slicer)) {
          const parentFilter = slicer.children.find(
            (item) => getPropertyHierarchy(item.dimension) === property.hierarchyLevelFor
          )
          parentFilter.drill = Drill.Children
          this.drill({
            parent: parentFilter.dimension,
            slicer: parentFilter,
            dimension: parseDimension(property.name, entityType)
          })
        } else {
          this.drill({
            parent: slicer.dimension,
            slicer: {
              ...slicer,
              drill: Drill.Children
            },
            dimension: parseDimension(property.name, entityType)
          })
        }

        this.contextMenu.closeMenu()
      })
    )
  })

  readonly drillDown = this.updater((state, slicer: ISlicer) => {
    if (isAdvancedFilter(slicer)) {
      slicer.children.forEach((slicer) => {
        this.drill({
          parent: slicer.dimension,
          slicer: {
            ...slicer,
            drill: Drill.Children
          },
          dimension: slicer.dimension
        })
      })
    } else {
      this.drill({
        parent: slicer.dimension,
        slicer: {
          ...slicer,
          drill: Drill.Children
        },
        dimension: slicer.dimension
      })
    }
  })

  readonly clearDrill = this.updater((state) => {
    state.drilledDimensions = null
    state.selectedDrilledDimensions = null
  })

  screenshot() {
    const baseImage = this.echartsEngine.echarts.getDataURL({ type: 'png' })
    const downloadLink = document.createElement('a')
    document.body.appendChild(downloadLink)

    downloadLink.href = baseImage
    downloadLink.target = '_self'
    downloadLink.download = (this.title || 'image') + '.png'
    downloadLink.click()
  }

  downloadData() {
    csvDownload(this.echartsEngine.data.data, (this.title || 'data') + '.csv', ',')
  }

  @HostBinding('class.ngm-analytical-card__drilled')
  get _drilled() {
    return this.get((state) => state.selectedDrilledDimensions)
  }

  ngOnDestroy() {
    this.echartsEngine.onDestroy()
    super.onDestroy()
  }
}
