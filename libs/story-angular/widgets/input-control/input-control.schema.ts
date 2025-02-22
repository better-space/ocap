import { Injectable } from '@angular/core'
import {
  FilterSelectionType,
  getEntityProperty,
  getPropertyName,
  MemberSource,
  ParameterControlEnum,
  ParameterProperty,
  Property
} from '@metad/ocap-core'
import { FormlyFieldConfig } from '@ngx-formly/core'
import { PropertyCapacity } from '@metad/components/property'
import { ControlType, NxCoreService } from '@metad/core'
import { FilterControlType } from '@metad/story/core'
import {
  ColorOptions,
  DataSettingsSchemaService,
  DataTable,
  dateFilterOptions,
  FORMLY_ROW,
  FORMLY_W_1_2,
  FORMLY_W_FULL,
  hierarchyAttributes,
  SelectionType
} from '@metad/story/designer'
import { combineLatest, distinctUntilChanged, map, startWith, withLatestFrom } from 'rxjs'
import { determineControlType } from './types'

@Injectable()
export class InputControlSchemaService extends DataSettingsSchemaService {
  private readonly dimension$ = this.model$.pipe(
    map((model) => model?.dataSettings?.dimension),
    distinctUntilChanged((a, b) => getPropertyName(a) === getPropertyName(b))
  )

  private readonly controlType$ = combineLatest([
    this.dimension$,
    this.select((state) => state.model?.options?.controlType)
  ]).pipe(
    withLatestFrom(this.entityType$.pipe(startWith(null))),
    map(([[propertyName, controlType], entityType]) => {
      return {
        controlType: controlType ?? determineControlType(propertyName, entityType),
        property: getEntityProperty(entityType, propertyName)
      }
    }),
    distinctUntilChanged()
  )

  getSchema() {
    return combineLatest([
      this.translate.stream('Story.Widgets'),
      this.translate.stream('DateVariable'),
      this.controlType$
    ]).pipe(
      map(([i18nStoryWidgets, DateVariable, { controlType, property }]) => {
        return this.builderSchema(i18nStoryWidgets, DateVariable, controlType, property) as any
      })
    )
  }

  builderSchema(i18nStoryWidgets, DateVariable, controlType: ControlType | FilterControlType, property: Property) {
    const className = FORMLY_W_1_2

    const dimensionField = {
      className: FORMLY_W_FULL,
      key: 'dimension',
      type: 'input-control',
      props: {
        dataSettings: this.dataSettings$,
        entityType: this.entityType$,
        capacities: [PropertyCapacity.Dimension, PropertyCapacity.Parameter, PropertyCapacity.MeasureControl]
      }
    }

    const dataSettings = this.generateDataSettingsSchema(i18nStoryWidgets?.Common, dimensionField)

    const optionsFieldGroup: FormlyFieldConfig[] = [
      {
        key: 'defaultMembers',
        type: 'empty',
        className: FORMLY_W_FULL,
      }
    ]

    if (controlType === FilterControlType.Parameter) {
      optionsFieldGroup.push(...ParameterSchema(<ParameterProperty>property, className, i18nStoryWidgets))
    } else if (controlType === FilterControlType.Datepicker) {
      optionsFieldGroup.push(
        InputControlControlType(className, i18nStoryWidgets?.InputControl),
        ...dateSchema(this.coreService, className, i18nStoryWidgets?.Filter, DateVariable)
      )
    } else if (controlType === FilterControlType.MeasureControl) {
      optionsFieldGroup.push(...MeasureControlFieldGroup(className, i18nStoryWidgets))
    } else {
      optionsFieldGroup.push(
        InputControlControlType(className, i18nStoryWidgets?.InputControl),
        SelectionType(className, i18nStoryWidgets),
        {
          className,
          key: 'hideSingleSelectionIndicator',
          type: 'checkbox',
          props: {
            label: i18nStoryWidgets?.InputControl?.HideSingleSelectionIndicator ?? 'Hide Single Selection Indicator'
          },
          expressions: {
            hide: `!model || model.controlType !== '${FilterControlType.Select}' || model.selectionType !== '${FilterSelectionType.Single}'`
          }
        },
        {
          className,
          key: 'maxTagCount',
          type: 'input',
          props: {
            label: i18nStoryWidgets?.InputControl?.MaxTagCount ?? 'Max Tag Count',
            type: 'number'
          },
          expressions: {
            hide: `!model || model.selectionType !== '${FilterSelectionType.Multiple}'`
          }
        },
        {
          className,
          key: 'autoActiveFirst',
          type: 'checkbox',
          props: {
            label: i18nStoryWidgets?.InputControl?.AutoActiveFirst ?? 'Auto Active First'
          }
        },
        {
          className,
          key: 'searchable',
          type: 'checkbox',
          props: {
            label: i18nStoryWidgets?.InputControl?.Searchable ?? 'Searchable'
          }
        },
        {
          className,
          key: 'cascadingEffect',
          type: 'checkbox',
          props: {
            label: i18nStoryWidgets?.InputControl?.CascadingEffect ?? 'Cascading Effect'
          }
        },
        {
          className,
          key: 'memberSource',
          type: 'select',
          props: {
            label: i18nStoryWidgets?.InputControl?.MemberSource ?? 'Member Source',
            options: [
              { label: i18nStoryWidgets?.InputControl?.MemberSource_AUTO ?? 'Auto', value: null },
              { label: i18nStoryWidgets?.InputControl?.MemberSource_CUBE ?? 'Cube', value: MemberSource.CUBE },
              {
                label: i18nStoryWidgets?.InputControl?.MemberSource_DIMENSION ?? 'Dimension',
                value: MemberSource.DIMENSION
              }
            ]
          },
          expressions: {
            // 'props.disabled': (field: FormlyFieldConfig) => {
            //   return !field.model || field.model.cascadingEffect
            // },
          }
        }
      )
    }

    if (controlType === FilterControlType.TreeSelect) {
      optionsFieldGroup.push(...hierarchyAttributes(i18nStoryWidgets?.Common))
    }

    if (controlType === ControlType.dropDownList) {
      optionsFieldGroup.push(DataTable('nx-formly__col nx-formly__col-12', i18nStoryWidgets?.Filter))
    }

    return [
      {
        wrappers: ['panel'],
        props: {
          padding: true
        },
        fieldGroup: [
          {
            key: 'title',
            type: 'input',
            props: {
              label: i18nStoryWidgets?.Common?.Title ?? 'Title',
              placeholder: i18nStoryWidgets?.InputControl?.InputControlTitle ?? 'Input Control Title'
            }
          }
        ]
      },
      dataSettings,
      {
        key: 'options',
        wrappers: ['expansion'],
        props: {
          label: i18nStoryWidgets?.InputControl?.Options ?? 'Options',
          expanded: true
        },
        fieldGroup: [
          {
            fieldGroupClassName: FORMLY_ROW,
            fieldGroup: [
              // {
              //   className: 'nx-formly__col nx-formly__col-12',
              //   key: 'dimension',
              //   type: 'input-control',
              //   props: {
              //     dataSettings: this.dataSettings$,
              //     entityType: this.entityType$,
              //     capacities: [PropertyCapacity.Dimension, PropertyCapacity.Parameter, PropertyCapacity.MeasureControl]
              //   }
              // },
              ...optionsFieldGroup
            ]
          }
        ]
      }
    ]
  }

  // get timeFilters() {
  //   return [
  //     {
  //       key: 'Full Period',
  //       type: 'select',
  //       props: {
  //         label: 'Full Period',
  //         placeholder: 'Select Full Period',
  //         options: [
  //           { label: 'Year', value: 'Year' },
  //           { label: 'Month', value: 'Month' }
  //         ]
  //       }
  //     },
  //     {
  //       key: 'To Date',
  //       type: 'select',
  //       props: {
  //         label: 'To Date',
  //         placeholder: 'Select To Date',
  //         options: [
  //           { label: 'Year', value: 'Year' },
  //           { label: 'Quarter', value: 'Quarter' },
  //           { label: 'Month', value: 'Month' }
  //         ]
  //       }
  //     }
  //   ]
  // }
}

function ParameterSchema(property: ParameterProperty, className: string, I18N) {
  const hideExpression = `!model || !model.slider`

  const fieldGroup: any[] = []
  if (property.paramType === ParameterControlEnum.Input && property.dataType === 'number') {
    fieldGroup.push(
      {
        className: FORMLY_W_FULL,
        key: 'slider',
        type: 'toggle',
        props: {
          label: I18N?.InputControl?.UseSlider ?? 'Use Slider'
        }
      },
      {
        className,
        key: 'sliderMax',
        type: 'input',
        props: {
          label: I18N?.InputControl?.SliderMax ?? 'Slider Max'
        },
        expressions: {
          hide: hideExpression
        }
      },
      {
        className,
        key: 'sliderMin',
        type: 'input',
        props: {
          label: I18N?.InputControl?.SliderMin ?? 'Slider Min'
        },
        expressions: {
          hide: hideExpression
        }
      },
      {
        className,
        key: 'sliderStep',
        type: 'input',
        props: {
          label: I18N?.InputControl?.SliderStep ?? 'Slider Step'
        },
        expressions: {
          hide: hideExpression
        }
      },
      {
        className,
        key: 'sliderColor',
        type: 'select',
        props: {
          label: I18N?.InputControl?.Color ?? 'Color',
          options: ColorOptions(I18N)
        },
        expressions: {
          hide: hideExpression
        }
      },
      // {
      //   className,
      //   key: 'sliderInvert',
      //   type: 'checkbox',
      //   props: {
      //     label: I18N?.InputControl?.SliderInvert ?? 'Slider Invert'
      //   },
      //   expressions: {
      //     hide: hideExpression
      //   }
      // },
      // {
      //   className,
      //   key: 'sliderVertical',
      //   type: 'checkbox',
      //   props: {
      //     label: I18N?.InputControl?.SliderVertical ?? 'Slider Vertical'
      //   },
      //   expressions: {
      //     hide: hideExpression
      //   }
      // },
      {
        className,
        key: 'showThumbLabel',
        type: 'checkbox',
        props: {
          label: I18N?.InputControl?.showThumbLabel ?? 'Show Thumb Label'
        },
        expressions: {
          hide: hideExpression
        }
      },
      {
        className,
        key: 'showTickMarks',
        type: 'checkbox',
        props: {
          label: I18N?.InputControl?.ShowTickMarks ?? 'Show Tick Marks'
        },
        expressions: {
          hide: hideExpression
        }
      }
    )
  } else if (property.paramType === ParameterControlEnum.Dimensions) {
    fieldGroup.push(SelectionType(className, I18N))
  } else if (property.paramType === ParameterControlEnum.Select) {
    fieldGroup.push(SelectionType(className, I18N))
  }

  return fieldGroup
}

function dateSchema(coreService: NxCoreService, className: string, I18N, DateVariable) {
  return [
    {
      className: FORMLY_W_1_2,
      key: 'selectionType',
      type: 'select',
      props: {
        label: I18N?.SelectionType ?? 'Selection Type',
        options: [
          { value: FilterSelectionType.SingleRange, label: I18N?.SingleRange ?? 'Range' },
          { value: FilterSelectionType.Single, label: I18N?.Single ?? 'Single' }
        ]
      }
    },
    ...dateFilterOptions(coreService, className, I18N, DateVariable)
  ]
}

function InputControlControlType(className: string, InputControl) {
  return {
    className,
    key: 'controlType',
    type: 'select',
    props: {
      label: InputControl?.ControlType ?? 'Control Type',
      options: [
        { value: null, label: InputControl?.Auto ?? 'Auto' },
        {
          value: FilterControlType.TreeSelect,
          label: InputControl?.TreeSelect ?? 'Tree Select'
        },
        { value: FilterControlType.Select, label: InputControl?.FlatSelect ?? 'Flat Select' },
        { value: ControlType.dropDownList, label: InputControl?.DropDownList ?? 'Dropdown List' }
      ]
    }
  }
}

function MeasureControlFieldGroup(className: string, I18N,) {
  return [
    {
      className,
      key: 'chipColor',
      type: 'select',
      props: {
        label: I18N?.InputControl?.Color ?? 'Color',
        options: ColorOptions(I18N)
      }
    },
    // 暂时还没起作用
    // {
    //   className,
    //   key: 'ariaOrientation',
    //   type: 'select',
    //   props: {
    //     label: I18N?.InputControl?.AriaOrientation ?? 'Orientation',
    //     options: [
    //       { value: 'horizontal', label: I18N?.InputControl?.Horizontal ?? 'Horizontal' },
    //       { value: 'vertical', label: I18N?.InputControl?.Vertical ?? 'Vertical' },
    //     ]
    //   }
    // },

    {
      className,
      key: 'hideSingleSelectionIndicator',
      type: 'checkbox',
      props: {
        label: I18N?.InputControl?.HideSelectionIndicator ?? 'Hide Selection Indicator',
      }
    },

    {
      className,
      key: 'highlighted',
      type: 'checkbox',
      props: {
        label: I18N?.InputControl?.HighlightedOptions ?? 'Highlighted Options',
      }
    },
  ]
}