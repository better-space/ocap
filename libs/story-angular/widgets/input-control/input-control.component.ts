import { Component, Signal, ViewChild, ViewContainerRef, computed, effect, inject, signal } from '@angular/core'
import { FormControl } from '@angular/forms'
import { MatDialog } from '@angular/material/dialog'
import { NgmMemberTreeComponent } from '@metad/ocap-angular/controls'
import { NgmDSCoreService, NgmSmartFilterBarService } from '@metad/ocap-angular/core'
import {
  EntityType,
  getEntityDimensions,
  getEntityMeasures,
  getEntityProperty,
  isCalculationProperty,
  ISlicer,
  isMeasureControlProperty,
  MeasureControlProperty,
  isEntityType,
  DataSettings,
  isParameterProperty,
  ParameterProperty,
  IMember,
  PropertyMeasure,
  isEmpty,
  Dimension
} from '@metad/ocap-core'
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy'
import { CalculationEditorComponent } from '@metad/components/property'
import {
  AbstractStoryWidget,
  ControlType,
  StoryWidgetState,
  StoryWidgetStyling,
  WidgetMenuType,
  nonBlank,
} from '@metad/core'
import { FilterControlType, NxStoryService, StoryPointState } from '@metad/story/core'
import { NGXLogger } from 'ngx-logger'
import { BehaviorSubject, combineLatest, firstValueFrom, timer } from 'rxjs'
import {
  combineLatestWith,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  switchMap,
  withLatestFrom
} from 'rxjs/operators'
import { determineControlType, InputControlOptions } from './types'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { NgmParameterCreateComponent } from '@metad/ocap-angular/parameter'


export interface InputControlStyling extends StoryWidgetStyling {
  widget: unknown
}

export interface InputControlState extends StoryWidgetState<InputControlOptions, InputControlStyling> {
  entityType: EntityType
}

@UntilDestroy({ checkProperties: true })
@Component({
  selector: 'pac-input-control',
  templateUrl: './input-control.component.html',
  styleUrls: ['./input-control.component.scss'],
  host: {
    class: 'pac-input-control'
  }
})
export class NxInputControlComponent
  extends AbstractStoryWidget<InputControlOptions, InputControlState>
{
  CONTROL_TYPE = ControlType
  INPUT_CONTROL_TYPE = FilterControlType

  private readonly dsCoreService = inject(NgmDSCoreService)
  private readonly storyService = inject(NxStoryService)
  private readonly _dialog = inject(MatDialog)
  private readonly filterBarService = inject(NgmSmartFilterBarService)
  private readonly _viewContainerRef = inject(ViewContainerRef)
  private readonly logger? = inject(NGXLogger, {optional: true})

  @ViewChild(NgmMemberTreeComponent) memberTree!: NgmMemberTreeComponent

  get slicer() {
    return this.slicer$.value
  }
  private slicer$ = new BehaviorSubject<ISlicer>(null)

  // Inner state control
  measureFormControl = new FormControl()
  measureControl = signal<string>(null)
  get measure() {
    return this.measureControl()
  }
  set measure(value) {
    this.measureControl.set(value)
  }
  // For datepicker component
  dates: Date[] = []

  public readonly styling$ = this.select((state) => state.styling)

  public readonly __options$ = this.select((state) => state.options).pipe(
    combineLatestWith(this.styling$),
    map(([options, styling]) => {
      return {
        ...(options ?? {}),
        ...(styling?.appearance ?? {})
      } as any
    })
  )

  public readonly dataSource$ = this.dataSettings$.pipe(
    map((dataSettings) => dataSettings?.dataSource),
    distinctUntilChanged(),
    filter((dataSource) => !!dataSource),
    switchMap((dataSource) => this.dsCoreService.getDataSource(dataSource)),
    untilDestroyed(this),
    shareReplay(1)
  )
  public readonly dimension = computed(() => this.dataSettingsSignal()?.dimension ?? this.optionsSignal()?.dimension)
  public readonly dimension$ = toObservable(this.dimension)

  public readonly entitySet$ = this.dataSettings$.pipe(map((dataSettings) => dataSettings?.entitySet))

  public readonly entityType$ = this.entitySet$.pipe(
    filter(nonBlank),
    switchMap((entity) =>
      this.dataSource$.pipe(
        switchMap((dataSource) => dataSource.selectEntityType(entity).pipe(filter(isEntityType))),
      )
    ),
    untilDestroyed(this),
    shareReplay(1)
  )

  public readonly dimensions$ = this.entityType$.pipe(map(getEntityDimensions))
  public readonly measures$ = this.entityType$.pipe(
    map(getEntityMeasures),
    map((items) => items?.filter((property) => !isMeasureControlProperty(property)))
  )

  public readonly maxTagCount = computed(() => this.optionsSignal()?.maxTagCount)
  public readonly controlType = computed(() => this.optionsSignal()?.controlType)

  public readonly property = computed(() => getEntityProperty(this.entityType(), this.dimension()))
  public readonly property$ = toObservable(this.property)
  public readonly title$ = computed(() => this.title || this.property()?.caption || this.property()?.name)
  public readonly parameter: Signal<ParameterProperty | null> = computed(() => {
    if (isParameterProperty(this.property())) {
      return this.property() as ParameterProperty
    }

    return null
  })

  public readonly type = computed(() => {
    if (this.asPlaceholder()) {
      return null
    }
    if (this.controlType()) {
      return this.controlType()
    }
    if (this.dimension()) {
      return determineControlType(this.dimension(), this.entityType())
    }
    return null
  })

  public measureControlProperty = computed(() => {
    if (isMeasureControlProperty(this.property())) {
      return this.property() as MeasureControlProperty
    }
  })
  public availableMeasures = computed(() => {
    return this.measureControlProperty()?.availableMembers?.map(({ value: measure }) =>
      getEntityProperty<PropertyMeasure>(this.entityType(), measure as string)
    ).filter(Boolean)
  })

  public readonly cascadingEffect$ = this.options$.pipe(map((options) => options?.cascadingEffect))
  public readonly dataSettings$ = combineLatest([
    this._dataSettings$,
    this.selectionVariant$.pipe(
      withLatestFrom(this.cascadingEffect$),
      filter(([, cascadingEffect]) => cascadingEffect),
      startWith([null]),
    ),
    this.presentationVariant$]
  )
    .pipe(
      map(([dataSettings, [selectionVariant], presentationVariant]) => {
        return {
          ...(dataSettings ?? {}),
          selectionVariant,
          presentationVariant
        } as DataSettings & {dimension?: Dimension}
      }),
    )
  public members = toSignal(this.slicer$.pipe(map((slicer) => slicer?.members ?? []), startWith([])))

  public readonly displayMembers = computed(() => {
    const members = [...this.members(), ...(<IMember[]>this.parameter()?.members ?? [])]
    const maxTagCount = this.maxTagCount() || 1

    let text = members
      .slice(0, maxTagCount)
      .map((m) => m.caption || m.key || m.value)
      .join(',')
    if (members.length > maxTagCount) {
      text = text + `+${members.length - maxTagCount}`
    }
    return text
  })

  public readonly asPlaceholder = computed(() => !(this.dataSettingsSignal()?.dataSource && this.dataSettingsSignal()?.entitySet))

  // Inner states
  private storyPoints = toSignal<StoryPointState[]>(this.storyService.pageStates$)
  public readonly error = signal<string>(null)
  /**
  |--------------------------------------------------------------------------
  | Subscriptions (effect)
  |--------------------------------------------------------------------------
  */
  private readonly entityTypeSub = this.entityType$.pipe(takeUntilDestroyed()).subscribe((entityType) => {
    this.entityType.set(entityType)
  })
  private _menuClickSub = this.widgetService.onMenuClick().subscribe(async (menu) => {
    switch(menu.key) {
      case 'clearDefaultMembers':
        this.updateOptions({
          defaultMembers: [],
          dates: []
        })
        break;
      case 'saveAsDefaultMembers':
        this.updateOptions({
          defaultMembers: [...this.slicer.members],
          dates: this.dates.map((d) => d.toISOString())
        })
        break;
      case 'editInputControl':
        await this.openEditInputControl()
        break
    }
  })

  private datesSub = this.options$.pipe(
    map((options) => options?.dates),
    distinctUntilChanged(),
  ).subscribe((dates) => {
    this.dates = dates?.map((d) => new Date(d)) ?? []
  })

  constructor() {
    super()
    effect(() => {
      if (this.measureControlProperty()?.value && !this.measureControl()) {
        this.measureControl.set(this.measureControlProperty()?.value as string)
      }
    }, {allowSignalWrites: true})

    effect(() => {
      if (this.measureControl()) {
        this.onMeasureSelectChange(this.measureControl())
      }
    }, {allowSignalWrites: true})

    effect(() => {
      if (this.parameter() && this.storyPoints().some((point) => point.widgets?.some((widget) => widget.key !== this.key && widget.dataSettings?.dimension?.dimension === this.parameter().name))) {
        this.error.set(this.getTranslation('Story.Widgets.InputControl.SamePropertyAlreadyExists', 'A component with the same property already exists'))
      } else {
        this.error.set(null)
      }
    }, {allowSignalWrites: true})

    effect(() => {
      const defaultMembers = this.optionsSignal()?.defaultMembers
      const property = this.property()

      const editProperty = isParameterProperty(property) || isCalculationProperty(property)
      const i18n = this.getTranslation('Story.Widgets.InputControl', {})
      const menus = []
      if (editProperty) {
        menus.push(
          {
            icon: 'filter_vintage',
            key: 'editInputControl',
            name: i18n?.EditInputControl ?? 'Edit Input Control',
            editable: editProperty,
            type: WidgetMenuType.Action
          }
        )
      }
      if (defaultMembers?.length) {
        menus.push({
          icon: 'bookmark_remove',
          key: 'clearDefaultMembers',
          name: i18n?.ClearDefaultMembers ?? 'Clear Default Members',
          editable: true,
          type: WidgetMenuType.Action
        })
      }
      this.widgetService.setMenus([
        ...menus,
        {
          icon: 'bookmark_add',
          key: 'saveAsDefaultMembers',
          name: i18n?.SaveAsDefaultMembers ?? 'Save as Default Members',
          editable: !isEmpty(this.members()),
          type: WidgetMenuType.Action
        }
      ])
    }, {allowSignalWrites: true})
  }

  refresh() {
    this.memberTree?.refresh(true)
  }

  trackByName(index: number, item: {name: string}) {
    return item.name
  }

  async clearSelectedMembers() {
    const parameter = this.parameter()
    if (parameter) {
      this.updateParameterValue({members: []})
    } else {
      const _slicer = {
        ...this.slicer,
        members: []
      }
      this.slicer$.next(_slicer)
      this.slicersChange.emit([structuredClone(_slicer)])
    }
  }

  readonly setEntitySet = this.updater((state, name: string) => {
    state.dataSettings.entitySet = name
  })

  readonly setProperty = this.updater((state, name: string) => {
    state.options = state.options || ({} as InputControlOptions)
    state.dataSettings.dimension = {
      dimension: name
    }
  })

  async updateParameterValue(value: Partial<ParameterProperty>) {
    const dataSettings = this.dataSettingsSignal()
    const property = this.property()

    this.storyService.upsertParamter({
      dataSettings,
      parameter: {
        ...property,
        ...value,
        __id__: property.__id__
      } as ParameterProperty
    })

    // Refresh widgets in this filter bar context wait for entity type updated
    await firstValueFrom(timer(100))
    this.filterBarService.go()
  }

  async onMeasureSelectChange(name: string) {
    const dataSettings = await firstValueFrom(this.dataSettings$)
    const property = await firstValueFrom(this.property$)

    // this.measureFormControl.setValue(name)

    this.storyService.updateCalculationMeasure({
      dataSettings,
      calculation: {
        __id__: property.__id__,
        name: property.name,
        value: name
      } as MeasureControlProperty
    })

    // Refresh widgets in this filter bar context wait for entity type updated
    await firstValueFrom(timer(100))
    this.filterBarService.go()
  }

  async openCalculationEditor() {
    const dataSettings = await firstValueFrom(this.dataSettings$)
    const property = await firstValueFrom(this.property$)
    const entityType = await firstValueFrom(this.entityType$)
    const result = await firstValueFrom(this._dialog
      .open(CalculationEditorComponent, {
        viewContainerRef: this._viewContainerRef,
        data: {
          dsCoreService: this.dsCoreService,
          dataSettings,
          entityType,
          value: property
        }
      })
      .afterClosed())
    if (result) {
      this.storyService.updateCalculationMeasure({ dataSettings, calculation: result })
    }
  }

  async openParameterEditor() {
    const dataSettings = await firstValueFrom(this.dataSettings$)
    const property = await firstValueFrom(this.property$)
    const entityType = await firstValueFrom(this.entityType$)

    await firstValueFrom(this._dialog
      .open(NgmParameterCreateComponent, {
        viewContainerRef: this._viewContainerRef,
        data: {
          dataSettings,
          entityType,
          coreService: this.coreService,
          name: property.name
        }
      })
      .afterClosed()
    )
    
  }

  async openEditInputControl() {
    const property = await firstValueFrom(this.property$)
    if (isParameterProperty(property)) {
      await this.openParameterEditor()
    } else if (isCalculationProperty(property)) {
      await this.openCalculationEditor()
    }
  }

  /**
   * 响应子组件改变后的 Slicer, 不能再改变其对象引用, 否则就会造成死循环
   * 
   * @param slicer 
   */
  onSlicerChange(slicer: ISlicer) {
    if (!slicer.dimension) {
      slicer.dimension = this.dimension()
    }
    this.slicer$.next(slicer)
    // 发出去的 slicer 可能会被 readonly 化，那样将与判断 slicer 是否改变有冲突
    this.slicersChange.emit([structuredClone(this.slicer)])
  }

  openDesigner() {
    this.widgetService?.clickMenu({
      key: 'open_designer',
      type: WidgetMenuType.Action
    })
  }
}
