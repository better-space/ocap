import { Injectable } from '@angular/core'
import { PropertyHierarchy } from '@metad/ocap-core'
import { map } from 'rxjs/operators'
import { DimensionModeling } from './dimension.schema'
import { HierarchySchemaService } from './hierarchy.schema'
import { FORMLY_ROW, FORMLY_W_1_2 } from '@metad/story/designer'

@Injectable()
export class HierarchyAttributesSchema extends HierarchySchemaService<PropertyHierarchy> {
  HIERARCHY: any

  getSchema() {
    return this.translate.stream('PAC.MODEL.SCHEMA').pipe(
      map((SCHEMA) => {
        this.SCHEMA = SCHEMA
        this.DIMENSION = SCHEMA?.DIMENSION
        this.HIERARCHY = SCHEMA?.HIERARCHY

        const dimensionModeling = DimensionModeling(
          SCHEMA,
          this.hierarchyOptions$,
          this.fields$,
        )
        dimensionModeling.key = 'dimension'
        return [
          {
            type: 'tabs',
            fieldGroup: [
              {
                props: {
                  label: this.HIERARCHY?.TITLE ?? 'Hierarchy',
                  icon: 'h_mobiledata'
                },
                fieldGroup: [this.getModeling()]
              },
              {
                props: {
                  label: this.DIMENSION?.TITLE ?? 'Dimension',
                  icon: 'account_tree'
                },
                fieldGroup: [dimensionModeling]
              }
            ]
          }
        ] as any
      })
    )
  }

  getModeling() {
    const HIERARCHY = this.HIERARCHY
    const COMMON = this.SCHEMA?.COMMON
    return {
      key: 'modeling',
      wrappers: ['expansion'],
      props: {
        label: HIERARCHY?.Modeling ?? 'Modeling',
        expanded: true
      },
      fieldGroup: [
        {
          fieldGroupClassName: FORMLY_ROW,
          fieldGroup: [
            {
              key: 'name',
              type: 'input',
              className: FORMLY_W_1_2,
              props: {
                label: HIERARCHY?.Name ?? 'Name',
                readonly: true
              }
            },
            {
              key: 'caption',
              type: 'input',
              className: FORMLY_W_1_2,
              props: {
                label: COMMON?.Caption ?? 'Caption'
              }
            }
          ]
        },

        this.defaultMember()
      ]
    }
  }
}
