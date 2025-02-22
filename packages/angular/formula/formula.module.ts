import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'

import { FormsModule, ReactiveFormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatMenuModule } from '@angular/material/menu'
import { MatSidenavModule } from '@angular/material/sidenav'
import { MatTooltipModule } from '@angular/material/tooltip'
import { ResizerModule } from '@metad/ocap-angular/common'
import { OcapCoreModule } from '@metad/ocap-angular/core'
import { NgmEntitySchemaComponent } from '@metad/ocap-angular/entity'
import { TranslateModule } from '@ngx-translate/core'
import { MonacoEditorModule } from 'ngx-monaco-editor'
import { FormulaEditorComponent } from './editor/editor.component'

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatMenuModule,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    TranslateModule,
    
    MonacoEditorModule,

    OcapCoreModule,
    ResizerModule,
    NgmEntitySchemaComponent
  ],
  exports: [FormulaEditorComponent],
  declarations: [FormulaEditorComponent],
  providers: []
})
export class FormulaModule {}
