import { Injectable } from '@angular/core'
import { DimensionUsage } from '@metad/ocap-core'
import { FORMLY_ROW, FORMLY_W_1_2 } from '@metad/story/designer'
import { map } from 'rxjs'
import { CubeSchemaService } from './cube.schema'

@Injectable()
export class DimensionUsageSchemaService extends CubeSchemaService<DimensionUsage> {
  getSchema() {
    return this.translate.stream('PAC.MODEL.SCHEMA').pipe(
      map((SCHEMA) => {
        this.SCHEMA = SCHEMA
        return [
          {
            type: 'tabs',
            fieldGroup: [
              {
                props: {
                  label: SCHEMA?.DimensionUsage?.Title ?? 'Dimension Usage',
                  icon: 'account_tree'
                },
                fieldGroup: this.usageSettings
              },
              this.dataDistribution
            ]
          }
        ]
      })
    )
  }

  get usageSettings() {
    const COMMON = this.SCHEMA?.COMMON
    const className = FORMLY_W_1_2
    return [
      {
        key: 'modeling',
        wrappers: ['panel'],
        props: {
          label: COMMON?.Modeling ?? 'Modeling',
          padding: true
        },
        fieldGroup: [
          {
            fieldGroupClassName: FORMLY_ROW,
            fieldGroup: [
              {
                className,
                key: 'name',
                type: 'input',
                props: {
                  required: true,
                  label: COMMON?.Name ?? 'Name'
                }
              },
              {
                className,
                key: 'caption',
                type: 'input',
                props: {
                  label: COMMON?.Caption ?? 'Caption'
                }
              },
              {
                className,
                key: 'foreignKey',
                type: 'nx-select',
                props: {
                  required: true,
                  searchable: true,
                  label: COMMON?.ForeignKey ?? 'Foreign Key',
                  options: this.factFields$
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
