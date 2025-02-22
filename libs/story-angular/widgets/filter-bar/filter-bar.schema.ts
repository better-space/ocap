import { Injectable } from '@angular/core'
import { Dimension, nonNullable } from '@metad/ocap-core'
import { PropertyCapacity } from '@metad/components/property'
import {
  DataSettingsSchemaService,
  FORMLY_ROW,
  FORMLY_W_1_2,
  FORMLY_W_FULL,
  SchemaState,
  dateFilterOptions
} from '@metad/story/designer'
import { isEqual } from 'lodash-es'
import { Observable, combineLatest } from 'rxjs'
import { distinctUntilChanged, filter, map } from 'rxjs/operators'
import { CascadingEffect } from './types'

@Injectable()
export class StoryFilterBarSchemaService<T extends SchemaState = SchemaState> extends DataSettingsSchemaService<T> {
  readonly selectionFields$: Observable<any> = this.select((state) => state.dataSettings).pipe(
    filter(nonNullable),
    map((dataSettings) => dataSettings.selectionFieldsAnnotation),
    distinctUntilChanged(isEqual)
  )

  readonly propertyPaths$: Observable<Array<Dimension>> = this.selectionFields$.pipe(
    filter(nonNullable),
    map((selectionFields) => selectionFields.propertyPaths)
  )

  getSchema() {
    return combineLatest([this.translate.stream('Story'), this.translate.stream('DateVariable')]).pipe(
      map(([STORY_DESIGNER, DateVariable]) => {
        this.STORY_DESIGNER = STORY_DESIGNER
        return [this.filterBarDataSettings, this.getOptions(DateVariable)]
      })
    )
  }

  get filterBarDataSettings() {
    const dataSettings = this.generateDataSettingsSchema(this.STORY_DESIGNER?.Widgets?.Common)

    const SELECTION_FIELDS_ANNOTATION = this.STORY_DESIGNER?.Widgets?.Common?.SELECTION_FIELDS_ANNOTATION
    dataSettings.fieldGroup.push({
      key: 'selectionFieldsAnnotation',
      props: {
        required: true
      },
      fieldGroup: [
        {
          key: 'propertyPaths',
          type: 'array',
          props: {
            label: SELECTION_FIELDS_ANNOTATION?.DIMENSIONS ?? 'Dimensions',
            required: true,
            hideDelete: true
          },
          fieldArray: {
            key: 'propertyPaths',
            type: 'property-select',
            props: {
              removable: true,
              sortable: true,
              dataSettings: this.dataSettings$,
              entityType: this.entityType$,
              capacities: [PropertyCapacity.Dimension]
            }
          }
        }
      ]
    } as any)

    return dataSettings
  }

  getOptions(DateVariable) {
    const FILTER_BAR = this.STORY_DESIGNER.Widgets?.FilterBar
    return {
      key: 'options',
      wrappers: ['expansion'],
      templateOptions: {
        label: FILTER_BAR?.OPTIONS ?? 'Options',
        expanded: true
      },
      fieldGroup: [
        {
          key: 'filters',
          type: 'empty'
        },
        {
          fieldGroupClassName: FORMLY_ROW,
          fieldGroup: [
            {
              className: FORMLY_W_1_2,
              key: 'liveMode',
              type: 'toggle',
              templateOptions: {
                label: FILTER_BAR?.LIVE_MODE ?? 'Live Mode'
              }
            },

            {
              className: FORMLY_W_1_2,
              key: 'cascadingEffect',
              type: 'toggle',
              templateOptions: {
                label: FILTER_BAR?.CascadingEffect ?? 'Cascading Effect'
              }
            },
            {
              className: FORMLY_W_1_2,
              hideExpression: `!model || !model.cascadingEffect`,
              key: 'cascadingType',
              type: 'select',
              templateOptions: {
                label: FILTER_BAR?.CascadingType ?? 'Cascading Type',
                options: [
                  { value: null, label: FILTER_BAR?.CascadingType_Default ?? 'Default' },
                  { value: CascadingEffect.InTurn, label: FILTER_BAR?.CascadingType_InTurn ?? 'In Turn' },
                  { value: CascadingEffect.All, label: FILTER_BAR?.CascadingType_All ?? 'All' }
                ]
              }
            }
          ]
        },

        {
          key: 'today',
          fieldGroup: [
            {
              className: FORMLY_W_FULL,
              key: 'enable',
              type: 'toggle',
              templateOptions: {
                label: FILTER_BAR?.EnableToday ?? 'Enable Today'
              }
            },

            {
              fieldGroupClassName: FORMLY_ROW,
              hideExpression: `!model || !model.enable`,
              fieldGroup: [
                ...dateFilterOptions(this.coreService, FORMLY_W_1_2, this.STORY_DESIGNER?.Widgets?.Filter, DateVariable)
              ]
            }
          ]
        }
      ]
    }
  }
}
