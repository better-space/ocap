import { IModelQuery, IStory } from '@metad/contracts'
import {
  Cube,
  Dimension,
  EntityType,
  ISlicer,
  Measure,
  Property,
  PropertyDimension,
  PropertyHierarchy,
  Schema,
  SemanticModel,
} from '@metad/ocap-core'
import { NgmSemanticModel } from '@metad/cloud/state'
import { uuid } from '../../../@core'
import { AIOptions, CopilotChatMessage } from '@metad/copilot'

export enum MODEL_TYPE {
  /**
   * 自有多维分析模型
   */
  OLAP,
  /**
   * 第三方 XMLA 接口模型
   */
  XMLA,
  /**
   * SQL 模型
   */
  SQL
}

export enum TOOLBAR_ACTION_CATEGORY {
  WORKSPACE,
  GENERAL,
  DIMENSION,
  HIERARCHY
}

export enum ModelDesignerType {
  model = 'model',
  cube = 'cube',
  property = 'property',
  dimensionUsage = 'dimensionUsage',
  dimension = 'dimension',
  hierarchy = 'hierarchy',
  level = 'level',
  measure = 'measure',
  calculatedMember = 'calculatedMember',
  cubeAttributes = 'cubeAttributes',
  dimensionAttributes = 'dimensionAttributes',
  hierarchyAttributes = 'hierarchyAttributes',
  levelAttributes = 'levelAttributes',
  measureAttributes = 'measureAttributes',
  calculatedMemberAttributes = 'calculatedMemberAttributes'
}

export interface ModelQuery extends IModelQuery {
  id?: string
  key: string
  modelId: string
  name: string
  entities: string[]
  statement?: string
  aiOptions?: AIOptions
  conversations?: CopilotChatMessage[]
}

export interface QueryResult {
  statement: string
  columns?: any[]
  data?: any[]
  preview?: any[]
  error?: string
  stats?: {
      numberOfEntries: number
  }
}

export interface ModelQueryState {
  key: string
  origin?: ModelQuery
  query: ModelQuery
  dirty: boolean
  results: QueryResult[]
}

/**
 * 语义模型 UI State
 */
export interface PACModelState {
  model: NgmSemanticModel
  stories: Array<IStory>
  dataSourceName: string
  currentEntity: string // current entity
  viewEditor: {
    wordWrap: boolean
  }
  /**
   * 对于 SQL DB 做 XMLA 模型的， 这里是原始 SQL 数据库的表结构信息
   */
  // entitySets: Array<EntitySet>
  // substates
  ids: string[] | number[]
  cubes: ModelCubeState[]
  dimensions: ModelDimensionState[]
  activedEntities: Array<ModelCubeState | ModelDimensionState>
  queries?: ModelQueryState[]
}

export enum SemanticModelEntityType {
  CUBE = 'CUBE',
  DIMENSION = 'DIMENSION',
  VirtualCube = 'VirtualCube'
}

export interface SemanticModelEntity {
  type?: SemanticModelEntityType
  id: string
  name: string
  caption?: string
  dirty?: boolean
}

export interface EntityPreview {
  rows: Array<Dimension | Measure>;
  columns: Array<Dimension | Measure>;
  slicers: Array<ISlicer>
}

/**
 * Cube 状态管理
 */
export interface ModelCubeState extends SemanticModelEntity {
  /**
   * Entity Type Schema 中的设置
   */
  entityType?: EntityType
  /**
   * MDX Schema 中的设置
   */
  cube: Cube

  // 以下是运行时状态
  sqlLab: {
    statement?: string
  }
  selectedProperty?: string
  /**
   * Table fields for dimension role
   */
  dimensions?: Property[]
  /**
   * Table fields for measure role
   */
  measures?: Property[]
  preview?: EntityPreview
}

export interface ModelDimensionState extends SemanticModelEntity {
  dimension: PropertyDimension
  currentHierarchyIndex?: number
  currentHierarchy?: PropertyHierarchy
}

/**
 * 初始化 Cube 子状态
 *
 * @param model
 * @returns
 */
export function initEntitySubState(model: SemanticModel): Array<ModelCubeState> {
  const schema: Schema = model.schema
  return (
    schema?.cubes?.map((cube) => {
      return {
        type: SemanticModelEntityType.CUBE,
        id: cube.__id__ || uuid(),
        name: cube.name,
        caption: cube.caption,
        cube,
        sqlLab: {},
        preview: {
          rows: [],
          columns: [],
          slicers: []
        }
      }
    }) || []
  )
}

/**
 * 初始化 Dimension 子状态
 *
 * @param model
 * @returns
 */
export function initDimensionSubState(model: SemanticModel): Array<ModelDimensionState> {
  const schema: Schema = model.schema
  return (
    schema?.dimensions?.map((dimension) => {
      return {
        type: SemanticModelEntityType.DIMENSION,
        id: dimension.__id__ || uuid(),
        name: dimension.name,
        caption: dimension.caption,
        dimension
      }
    }) || []
  )
}

export enum HierarchyColumnType {
  Key,
  ParentChild,
  Level,
  Name
}

export interface RuntimeProperty extends Property {
  error?: string
}
