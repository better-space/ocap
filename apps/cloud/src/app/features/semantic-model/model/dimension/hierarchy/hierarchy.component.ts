import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop'
import { AfterViewInit, ChangeDetectorRef, Component, ViewChildren, inject } from '@angular/core'
import { ActivatedRoute } from '@angular/router'
import { NgmCommonModule, ResizerModule, SplitterModule } from '@metad/ocap-angular/common'
import { OcapCoreModule } from '@metad/ocap-angular/core'
import { NgmEntitySchemaComponent, EntitySchemaNode, EntitySchemaType, EntityCapacity } from '@metad/ocap-angular/entity'
import { C_MEASURES, DisplayBehaviour, PropertyLevel, Table } from '@metad/ocap-core'
import { C_MEASURES_ROW_COUNT, serializeMeasureName, serializeUniqueName } from '@metad/ocap-sql'
import { ContentLoaderModule } from '@ngneat/content-loader'
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy'
import { TranslateService } from '@ngx-translate/core'
import { NxTableModule } from '@metad/components/table'
import { nonNullable } from '@metad/core'
import { NxSettingsPanelService } from '@metad/story/designer'
import { NgmError, ToastrService, uuid } from 'apps/cloud/src/app/@core'
import { MaterialModule, SharedModule } from 'apps/cloud/src/app/@shared'
import { isEqual } from 'lodash-es'
import { NGXLogger } from 'ngx-logger'
import { BehaviorSubject, of } from 'rxjs'
import {
  combineLatestWith,
  debounceTime,
  delayWhen,
  distinctUntilChanged,
  filter,
  first,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
  withLatestFrom
} from 'rxjs/operators'
import { TablesJoinModule } from '../../../tables-join'
import { ModelComponent } from '../../model.component'
import { SemanticModelService } from '../../model.service'
import { HierarchyColumnType, TOOLBAR_ACTION_CATEGORY } from '../../types'
import { ModelDimensionComponent } from '../dimension.component'
import { ModelDimensionService } from '../dimension.service'
import { ModelHierarchyService } from './hierarchy.service'

@UntilDestroy({ checkProperties: true })
@Component({
  standalone: true,
  selector: 'pac-model-hierarchy',
  templateUrl: 'hierarchy.component.html',
  styleUrls: ['hierarchy.component.scss'],
  host: {
    class: 'pac-model-hierarchy'
  },
  providers: [ModelHierarchyService],
  imports: [
    SharedModule,
    MaterialModule,
    ContentLoaderModule,

    NxTableModule,

    OcapCoreModule,
    ResizerModule,
    SplitterModule,
    NgmEntitySchemaComponent,
    NgmCommonModule,

    TablesJoinModule
  ]
})
export class ModelHierarchyComponent implements AfterViewInit {
  uuid = uuid()
  DisplayBehaviour = DisplayBehaviour
  COLUMN_TYPE = HierarchyColumnType
  EntityCapacity = EntityCapacity

  private readonly dimensionComponent = inject(ModelDimensionComponent)
  private readonly settingsService = inject(NxSettingsPanelService)
  private readonly toastrService = inject(ToastrService)

  @ViewChildren(CdkDropList) cdkDropList: CdkDropList[]

  // Translations
  private T_Count = 'Count'

  // Signal
  // States
  get designerComponentId() {
    return this.settingsService.settingsComponent.id
  }

  entities = [] as any
  get dataSourceName() {
    return this.modelService.originalDataSource?.options.name
  }

  tablesJoinCollapsed = true
  loading = false

  public readonly tables$ = this.hierarchyService.tables$.pipe(
    tap((tables) => {
      if (tables?.length > 1) {
        this.tablesJoinCollapsed = false
      }
    })
  )
  public readonly tableName$ = this.hierarchyService.tableName$
  public readonly levels$ = this.hierarchyService.levels$

  readonly queryOptions$ = this.levels$.pipe(
    filter((levels) => !!levels),
    combineLatestWith(this.dimensionService.name$, this.hierarchyService.name$, this.modelService.dialect$),
    map(([levels, dimension, hierarchy, dialect]) => {
      return {
        rows: levels.map((level) => ({
          dimension: serializeUniqueName(dialect, dimension),
          hierarchy: serializeUniqueName(dialect, dimension, hierarchy),
          level: serializeUniqueName(dialect, dimension, hierarchy, level.name),
          properties: level.properties
            ?.filter((property) => property.column && property.name)
            .map((property) => serializeUniqueName(dialect, dimension, hierarchy, property.name))
        })),
        columns: [
          {
            dimension: C_MEASURES,
            measure: C_MEASURES_ROW_COUNT
          }
        ]
      }
    }),
    // Avoid unnecessary refresh
    distinctUntilChanged(isEqual),
    shareReplay(1)
  )

  public readonly columns$ = this.levels$.pipe(
    filter(nonNullable),
    combineLatestWith(this.dimensionService.name$, this.hierarchyService.name$, this.modelService.dialect$),
    map(([levels, dimension, hierarchy, dialect]) => {
      const columns = []
      levels.forEach((level) => {
        columns.push({
          name: serializeUniqueName(dialect, dimension, hierarchy, level.name, 'MEMBER_CAPTION'),
          caption: level.caption || level.name
        })

        if (level.parentColumn) {
          columns.push({
            name: serializeUniqueName(dialect, dimension, hierarchy, level.name, 'PARENT_UNIQUE_NAME'),
            caption: (level.caption || level.name) + '(Parent)'
          })
        }

        level.properties
          ?.filter((property) => property.column && property.name)
          .forEach((property) => {
            columns.push({
              name: serializeUniqueName(dialect, dimension, hierarchy, property.name),
              caption: property.caption || property.name
            })
          })
      })

      columns.push({
        name: serializeMeasureName(dialect, C_MEASURES_ROW_COUNT),
        caption: this.T_Count
      })
      return columns
    })
  )

  private refresh$ = new BehaviorSubject<void>(null)

  readonly query$ = this.queryOptions$.pipe(
    // Waiting for Dimension Schema updated in DataSource
    debounceTime(300),
    // Waiting for entityService
    delayWhen(() => this.dimensionService.dimEntityService$),
    withLatestFrom(this.dimensionService.dimEntityService$),
    switchMap(([queryOptions, entityService]) => {
      return queryOptions.rows?.length
        ? entityService.selectEntityType().pipe(
            filter(nonNullable), // Wait for EntityType initialed
            first(),
            switchMap(() => this.refresh$),
            switchMap(() => {
              this.loading = true
              return entityService.selectQuery(queryOptions).pipe(tap(() => (this.loading = false)))
            })
          )
        : of({
            data: [],
            error: null
          })
    }),
    tap((result) => this.logger.debug(`Dimension Levels Preview Query result`, result)),
    untilDestroyed(this),
    shareReplay(1)
  )

  public readonly data$ = this.query$.pipe(map(({ data }) => data))
  public readonly error$ = this.query$.pipe(map(({ error }) => error))

  /**
  |--------------------------------------------------------------------------
  | Subscriptions (effect)
  |--------------------------------------------------------------------------
  */
  // 手动 Stop Receiving dropListRef, 因为官方的程序在跨页面 DropList 间似乎 detectChanges 时间先后有问题
  private _dragReleasedSub = this.modelService.dragReleased$.subscribe((_dropListRef) => {
    this.cdkDropList.forEach((list) => list._dropListRef._stopReceiving(_dropListRef))
    this._cdr.detectChanges()
  })

  private toolbarActionsSub = this.modelComponent.toolbarAction$
    .pipe(filter(({ category, action }) => category === TOOLBAR_ACTION_CATEGORY.HIERARCHY))
    .subscribe(({ category, action }) => {
      if (action === 'RemoveLevel') {
        this.hierarchyService.removeCurrentLevel()
      }
    })
  private countTSub = this.translateService
    .get('PAC.MODEL.DIMENSION.Count', { Default: 'Count' })
    .subscribe((value) => {
      this.T_Count = value
    })
  constructor(
    public modelService: SemanticModelService,
    private modelComponent: ModelComponent,
    private dimensionService: ModelDimensionService,
    private hierarchyService: ModelHierarchyService,
    private route: ActivatedRoute,
    private logger: NGXLogger,
    private translateService: TranslateService,
    private _cdr: ChangeDetectorRef
  ) {
    this.route.paramMap
      .pipe(
        startWith(this.route.snapshot.paramMap),
        map((paramMap) => paramMap.get('id')),
        filter((value) => !!value),
        distinctUntilChanged(),
        untilDestroyed(this)
      )
      .subscribe((id) => {
        this.hierarchyService.init(id)
      })
  }

  ngAfterViewInit(): void {
    this.hierarchyService.setupDesigner()
  }

  trackByName(i: number, item: Table) {
    return item.name
  }

  tablesPredicate(event: CdkDrag<EntitySchemaNode>) {
    return (
      event.dropContainer.id === 'pac-model-entitysets' ||
      event.dropContainer.id === 'pac-model-dimension__hierarchy-levels'
    )
  }

  /**
   * 往 Tables 区域添加 table
   */
  dropTable(event: CdkDragDrop<{ name: string }[]>) {
    if (event.previousContainer.id === 'pac-model-entitysets' && event.item.data.name) {
      this.hierarchyService.appendTable(event.item.data.name)
    } else if (event.previousContainer.id === 'pac-model-dimension__hierarchy-levels') {
      this.hierarchyService.removeLevel(event.item.data.__id__)
    } else if (event.previousContainer.id === event.container.id) {
      this.hierarchyService.moveItemInTables(event)
    }
  }

  levelPredicate(item: CdkDrag<EntitySchemaNode>) {
    return item.data.type === EntitySchemaType.Dimension || item.data.type === EntitySchemaType.IMeasure
  }

  dropLevel(event: CdkDragDrop<PropertyLevel[]>) {
    try {
      if (event.previousContainer.id === event.container.id) {
        this.hierarchyService.moveLevelInArray(event)
      } else if (event.previousContainer.id === 'pac-model-dimension__hierarchy-tables' && event.item.data.name) {
        this.hierarchyService.appendLevel({ name: event.item.data.name, table: event.item.data.entity })
      }
    } catch(err: any) {
      this.toastrService.error((<NgmError>err).code, '', {Default: (<NgmError>err).message})
    }
  }

  onLevelSelect(value: string) {
    this.hierarchyService.setupLevelDesigner(value)
    this.dimensionComponent.openDesignerPanel()
  }

  onTablesChange(event) {
    this.hierarchyService.setTables(event)
  }

  levelRemovePredicate(item: CdkDrag<PropertyLevel>) {
    return item.dropContainer.id === 'pac-model-dimension__hierarchy-levels'
  }

  removeLevel(event: CdkDragDrop<PropertyLevel[]>) {
    this.hierarchyService.removeLevel(event.item.data.__id__)
  }

  tableRemovePredicate(item: CdkDrag<EntitySchemaNode>) {
    return (
      item.dropContainer.id === 'pac-model-dimension__hierarchy-tables' && item.data.type === EntitySchemaType.Entity
    )
  }

  removeTable(event: CdkDragDrop<EntitySchemaNode[]>) {
    this.hierarchyService.removeTable(event.item.data.name)
  }

  refresh() {
    this.refresh$.next()
  }
}
