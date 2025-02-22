import { NgmDSCoreService } from '@metad/ocap-angular/core'
import { WasmAgentService } from '@metad/ocap-angular/wasm-agent'
import {
  AgentType,
  DataSourceOptions,
  EntityType,
  getEntityDimensions,
  getEntityMeasures,
  isNil,
  omit,
  Syntax
} from '@metad/ocap-core'
import { NgmSemanticModel } from '@metad/cloud/state'
import { getSemanticModelKey } from '@metad/story/core'

export function registerModel(model: NgmSemanticModel, dsCoreService: NgmDSCoreService, wasmAgent: WasmAgentService) {
  const agentType = isNil(model.dataSource)
    ? AgentType.Wasm
    : model.dataSource.useLocalAgent
    ? AgentType.Local
    : AgentType.Server
  const dialect =
    model.dataSource?.type?.type === 'agent'
      ? 'sqlite'
      : agentType === AgentType.Wasm
      ? 'duckdb'
      : model.dataSource?.type?.type
  const catalog = agentType === AgentType.Wasm ? model.catalog || 'main' : model.catalog
  const semanticModel = {
    ...omit(model, 'indicators'),
    name: getSemanticModelKey(model),
    catalog,
    dialect,
    agentType,
    settings: {
      dataSourceInfo: model.dataSource?.options?.data_source_info as string
    } as any,
    schema: {
      ...(model.schema ?? {}),
      indicators: model.indicators
    }
  } as DataSourceOptions

  if (model.dataSource?.type?.protocol?.toUpperCase() === 'SQL') {
    semanticModel.settings = semanticModel.settings
      ? { ...semanticModel.settings }
      : {
          ignoreUnknownProperty: true
        }
    semanticModel.settings.dataSourceId = model.dataSource.id
  }

  if (model.type === 'XMLA') {
    semanticModel.syntax = Syntax.MDX
    if (model.dataSource?.type?.protocol?.toUpperCase() === 'SQL') {
      dsCoreService.registerModel({
        ...semanticModel,
        name: getSQLSourceName(model.key ?? model.name),
        type: 'SQL',
        syntax: Syntax.SQL
      })

      dsCoreService.registerModel({
        ...semanticModel,
        catalog: model.name,
        syntax: Syntax.MDX,
        settings: {
          ...(semanticModel.settings ?? {}),
          dataSourceInfo: model.id
        } as any
      })
    } else {
      dsCoreService.registerModel({
        ...semanticModel,
        syntax: Syntax.MDX,
        settings: {
          ...semanticModel.settings,
          dataSourceInfo: model.dataSource?.options?.data_source_info
        } as any
      })
    }
  } else {
    dsCoreService.registerModel({
      ...semanticModel,
      syntax: Syntax.SQL,
      settings: {
        ...semanticModel.settings,
        dataSourceInfo: model.dataSource?.options?.data_source_info
      } as any
    })
  }

  if (semanticModel.agentType === AgentType.Wasm) {
    // 先初始化 wasm 服务
    wasmAgent.registerModel({
      ...semanticModel
    })
  }

  return semanticModel
}

export function getSQLSourceName(key: string) {
  return key + '_SQL_SOURCE'
}

export function registerWasmAgentModel(wasmAgent: WasmAgentService, model: NgmSemanticModel) {
  wasmAgent.registerModel({
    ...model,
    name: getSemanticModelKey(model),
    catalog: model.catalog ?? 'main'
  })
}

export function calcEntityTypePrompt(entityType: EntityType) {
  return JSON.stringify({
    name: entityType.name,
    caption: entityType.caption,
    dimensions: getEntityDimensions(entityType).map((dimension) => ({
      name: dimension.name,
      caption: dimension.caption,
      hierarchies: dimension.hierarchies?.map((item) => ({
        name: item.name,
        caption: item.name,
        levels: item.levels?.map((item) => ({
          name: item.name,
          caption: item.caption
        }))
      }))
    })),
    measures: getEntityMeasures(entityType).map((item) => ({
      name: item.name,
      caption: item.caption
    }))
  })
}
