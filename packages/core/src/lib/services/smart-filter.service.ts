import { combineLatest, distinctUntilChanged, filter, map, switchMap, withLatestFrom } from 'rxjs'
import { hierarchize } from '../annotations'
import { DSCoreService } from '../ds-core.service'
import {
  DimensionMemberRecursiveHierarchy,
  getEntityDefaultMeasure,
  getEntityHierarchy,
  IDimensionMember
} from '../models'
import { C_MEASURES, Dimension, getPropertyHierarchy, IMember, QueryOptions } from '../types'
import { isEqual, isNil, uniqBy } from '../utils'
import { SmartBusinessService, SmartBusinessState } from './smart-business.service'


export enum TypeAheadType {
  Local = 'Local',
  Remote = 'Remote'
}

export type TypeAhead = {
  type: TypeAheadType
  text?: string
  required?: boolean
  minimum?: number
}

export enum MemberSource {
  CUBE = 'CUBE',
  DIMENSION = 'DIMENSION'
}

export interface SmartFilterDataOptions {
  /**
   * @deprecated 使用独立的 dimension 属性设置
   */
  dimension?: Dimension
  typeAhead?: TypeAhead
  // the data source of value list members
  memberSource?: MemberSource
  // 是否显示 All 成员
  showAllMember?: boolean
}

export interface SmartFilterState extends SmartBusinessState {
  options: SmartFilterDataOptions
}

/**
 * 是否需要对 SelectOptions 进行响应过滤 Dimension Members
 */
export class SmartFilterService<State extends SmartFilterState = SmartFilterState> extends SmartBusinessService<
  IDimensionMember,
  State
> {
  set options(value) {
    this.patchState({ options: value } as State)
  }
  get options() {
    return this.get((state) => state.options)
  }
  get dimension() {
    return this.options?.dimension
  }

  public readonly dimension$ = this.select((state) => state.options?.dimension)

  readonly showAllMember$ = this.select((state) => state.options?.showAllMember)

  readonly membersWithSchema$ = combineLatest([this.selectResult().pipe(filter(({ data }) => !isNil(data))),this.showAllMember$])
    .pipe(
      withLatestFrom(this.selectEntityType()),
      map(([[{ data, schema }, showAllMember], entityType]) => {
        const hierarchy = getEntityHierarchy(entityType, this.dimension)
        let members = data
        if (!showAllMember && hierarchy?.allMember) {
          members = data.filter((item) => item.memberKey !== hierarchy.allMember)
        }

        return { members, schema }
      })
    )

  readonly selectOptions$ = this.membersWithSchema$.pipe(
    map(({members, schema}) => {
      return uniqBy<IMember>(
        members.map((item) => ({
          value: item.memberKey,
          caption: item.memberCaption
        })),
        'value'
      )
    })
  )

  readonly membersTree$ = this.membersWithSchema$.pipe(
    map(({ members, schema }) => {
      if (schema?.recursiveHierarchy) {
        return hierarchize(members, schema?.recursiveHierarchy)
      }

      return null
    })
  )

  constructor(dsCoreService: DSCoreService) {
    super(dsCoreService)
  }

  override onInit() {
    return super.onInit().pipe(
      switchMap(() =>
        this.dimension$.pipe(
          filter((dimension) => !!dimension),
          map((dimension) => ({
            dimension: dimension.dimension,
            hierarchy: dimension.hierarchy,
            level: dimension.level
          })),
          distinctUntilChanged(isEqual)
        )
      )
    )
  }

  override selectQuery(options?: QueryOptions) {
    const memberSource = this.options?.memberSource
    // Not specified CUBE source and not set level for dimension then get members from dimension tables
    if (memberSource !== MemberSource.CUBE && !this.dimension.level) {
      return this.entityService.selectMembers(this.dimension).pipe(
        map((data) => ({
          data,
          schema: {
            columns: [
              {
                name: 'memberKey',
                label: 'Member Key',
                type: 'string'
              },
              {
                name: 'memberCaption',
                label: 'Member Caption',
                type: 'string'
              },
              {
                name: 'parentKey',
                label: 'Parent Key',
                type: 'string'
              }
            ],
            recursiveHierarchy: DimensionMemberRecursiveHierarchy
          }
        }))
      )
    }

    const hProperty = getEntityHierarchy(this.entityType, this.dimension)

    const dimension = {
      ...this.dimension,
      dimension: this.dimension.dimension,
      hierarchy: hProperty?.name,
      level: this.dimension.level ?? hProperty?.levels?.[hProperty.levels.length - 1]?.name,
      displayHierarchy: !this.dimension.level
    }

    const measure = getEntityDefaultMeasure(this.entityType)

    options = options ?? {}
    options.rows = [dimension]
    options.columns = [
      {
        dimension: C_MEASURES,
        measure: measure.name
      } as Dimension
    ]

    options.filters = []

    // if (this.typeAhead?.type === TypeAheadType.Remote && !!this.typeAhead.text) {
    //   options.filters = [
    //     {
    //       dimension: { dimension: recursiveHierarchy.labelProperty },
    //       members: [{ value: this.typeAhead.text }],
    //       operator: FilterOperator.Contains
    //     }
    //   ]
    // }

    const propertyName = getPropertyHierarchy(dimension)

    return super.selectQuery(options).pipe(
      map((result) => {
        const valueProperty = dimension.hierarchy || dimension.dimension
        const captionProperty = dimension.memberCaption || hProperty?.memberCaption
        const data = result.data.map((item) => ({
          dimension: dimension.dimension,
          hierarchy: dimension.hierarchy || dimension.dimension,
          memberKey: item[valueProperty],
          memberCaption: item[captionProperty],
          parentKey: item[`${propertyName}.[PARENT_UNIQUE_NAME]`]
        }))

        return {
          data,
          schema: {
            columns: [
              {
                name: 'memberKey',
                label: 'Member Key',
                type: 'string'
              },
              {
                name: 'memberCaption',
                label: 'Member Caption',
                type: 'string'
              },
              {
                name: 'parentKey',
                label: 'Parent Key',
                type: 'string'
              }
            ],
            recursiveHierarchy: DimensionMemberRecursiveHierarchy
          }
        }
      })
    )
  }
}
