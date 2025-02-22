import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import {
  DensityDirective,
  NgmAgentService,
  NgmDSCacheService,
  OCAP_AGENT_TOKEN,
  OCAP_DATASOURCE_TOKEN
} from '@metad/ocap-angular/core'
import { NGM_WASM_AGENT_WORKER, WasmAgentService } from '@metad/ocap-angular/wasm-agent'
import { DataSource, Type } from '@metad/ocap-core'
import { LetDirective } from '@ngrx/component'
import { PacAuthModule } from '@metad/cloud/auth'
import { NxTableModule } from '@metad/components/table'
import { NgmCopilotService } from '@metad/core'
import { PACMaterialThemeModule } from '@metad/material-theme'
import { NX_STORY_FEED, NX_STORY_MODEL, NX_STORY_STORE } from '@metad/story/core'
import { NgxPopperjsModule } from 'ngx-popperjs'
import { CopilotService, DirtyCheckGuard, LocalAgent, ServerAgent } from '../@core/index'
import { AssetsComponent } from '../@shared/assets/assets.component'
import {
  CopilotChatComponent,
  CopilotGlobalComponent,
  MaterialModule,
  PACStatusBarComponent,
  SharedModule
} from '../@shared/index'
import { HeaderSettingsComponent, ProjectSelectorComponent } from '../@theme/header'
import { PACThemeModule } from '../@theme/theme.module'
import { StoryFeedService, StoryModelService, StoryStoreService } from '../services/index'
import { FeaturesRoutingModule } from './features-routing.module'
import { FeaturesComponent } from './features.component'

@NgModule({
  declarations: [FeaturesComponent],
  imports: [
    CommonModule,
    FeaturesRoutingModule,
    MaterialModule,
    SharedModule,
    PACMaterialThemeModule,
    PacAuthModule,
    PACThemeModule,
    PACStatusBarComponent,
    LetDirective,
    NgxPopperjsModule,
    HeaderSettingsComponent,
    AssetsComponent,
    ProjectSelectorComponent,
    CopilotChatComponent,
    NxTableModule.forRoot(),
    DensityDirective,
    CopilotGlobalComponent
  ],
  providers: [
    DirtyCheckGuard,
    NgmAgentService,
    NgmDSCacheService,
    {
      provide: NGM_WASM_AGENT_WORKER,
      useValue: '/assets/ocap-agent-data-init.worker.js'
    },
    WasmAgentService,
    {
      provide: OCAP_AGENT_TOKEN,
      useExisting: WasmAgentService,
      multi: true
    },
    LocalAgent,
    ServerAgent,
    {
      provide: OCAP_AGENT_TOKEN,
      useExisting: LocalAgent,
      multi: true
    },
    {
      provide: OCAP_AGENT_TOKEN,
      useExisting: ServerAgent,
      multi: true
    },
    {
      provide: OCAP_DATASOURCE_TOKEN,
      useValue: {
        type: 'SQL',
        factory: async (): Promise<Type<DataSource>> => {
          const { SQLDataSource } = await import('@metad/ocap-sql')
          return SQLDataSource
        }
      },
      multi: true
    },
    {
      provide: OCAP_DATASOURCE_TOKEN,
      useValue: {
        type: 'XMLA',
        factory: async (): Promise<Type<DataSource>> => {
          const { XmlaDataSource } = await import('@metad/ocap-xmla')
          return XmlaDataSource
        }
      },
      multi: true
    },
    {
      provide: NX_STORY_STORE,
      useClass: StoryStoreService
    },
    {
      provide: NX_STORY_MODEL,
      useClass: StoryModelService
    },
    {
      provide: NX_STORY_FEED,
      useClass: StoryFeedService
    },
    {
      provide: NgmCopilotService,
      useExisting: CopilotService
    }
  ]
})
export class FeaturesModule {}
