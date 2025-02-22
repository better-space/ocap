import { DragDropModule } from '@angular/cdk/drag-drop'
import { ScrollingModule } from '@angular/cdk/scrolling'
import { FlatTreeControl } from '@angular/cdk/tree'
import { CommonModule } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  inject
} from '@angular/core'
import { FormControl, ReactiveFormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'
import { MatTooltipModule } from '@angular/material/tooltip'
import { MatTreeModule } from '@angular/material/tree'
import { NgmCommonModule } from '@metad/ocap-angular/common'
import { NgmAppearance, NgmDSCoreService, OcapCoreModule } from '@metad/ocap-angular/core'
import { DataSettings } from '@metad/ocap-core'
import { UntilDestroy } from '@ngneat/until-destroy'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { EntitySchemaDataSource, EntitySchemaFlatNode } from './data-source'
import { EntityCapacity, EntitySchemaType } from './types'


@UntilDestroy()
@Component({
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatTreeModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    DragDropModule,
    ScrollingModule,
    TranslateModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    NgmCommonModule,
    OcapCoreModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngm-entity-schema',
  templateUrl: 'entity-schema.component.html',
  styleUrls: ['entity-schema.component.scss']
})
export class NgmEntitySchemaComponent implements OnInit, OnChanges {
  EntitySchemaType = EntitySchemaType
  @HostBinding('class.ngm-entity-schema') _isEntitySchemaComponent = true
  private translateService = inject(TranslateService)
  private _dsCoreService? = inject(NgmDSCoreService, {optional: true})

  @Input() dsCoreService: NgmDSCoreService
  @Input() dataSettings: DataSettings
  @Input() appearance: NgmAppearance
  @Input() selectedHierarchy: string
  @Input() capacities: EntityCapacity[]

  get searchControl() {
    return this.dataSource.searchControl
  }

  ngOnInit() {
    if (this.dsCoreService) {
      this._dsCoreService = this.dsCoreService
    }
    this.treeControl = new FlatTreeControl<EntitySchemaFlatNode>(this.getLevel, this.isExpandable)
    this.dataSource = new EntitySchemaDataSource(this.treeControl, this._dsCoreService, this.translateService, this.capacities)

    this.dataSource.data = []

    if (this.dataSettings.entitySet) {
      this.dataSource.dataSourceName = this.dataSettings.dataSource
      const rootNode = new EntitySchemaFlatNode(
        {
          type: EntitySchemaType.Entity,
          name: this.dataSettings.entitySet,
          caption: this.dataSettings.entitySet,
        },
        0,
        true
      )
      this.dataSource.data = [
        rootNode
      ]
    }
  }

  ngOnChanges({ dataSettings }: SimpleChanges): void {
    if (dataSettings?.currentValue?.entitySet && this.dataSource) {
      this.dataSource.dataSourceName = dataSettings.currentValue.dataSource
    }
  }

  treeControl: FlatTreeControl<EntitySchemaFlatNode>

  dataSource: EntitySchemaDataSource

  getLevel = (node: EntitySchemaFlatNode) => node.level

  isExpandable = (node: EntitySchemaFlatNode) => node.expandable

  hasChild = (_: number, _nodeData: EntitySchemaFlatNode) => _nodeData.expandable
}
