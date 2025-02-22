import { CommonModule } from '@angular/common'
import { ChangeDetectorRef, Component, inject } from '@angular/core'
import { FormControl, ReactiveFormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatDialog } from '@angular/material/dialog'
import { MatIconModule } from '@angular/material/icon'
import { ActivatedRoute } from '@angular/router'
import { NgmSearchComponent } from '@metad/ocap-angular/common'
import { AppearanceDirective, ButtonGroupDirective, DensityDirective } from '@metad/ocap-angular/core'
import { UntilDestroy } from '@ngneat/until-destroy'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ModelsService } from '@metad/cloud/state'
import { NxTableModule } from '@metad/components/table'
import { ISemanticModel, IUser, Store, ToastrService } from 'apps/cloud/src/app/@core'
import {
  TranslationBaseComponent,
  UserProfileComponent,
  UserProfileInlineComponent,
  UserRoleSelectComponent,
  userLabel
} from 'apps/cloud/src/app/@shared'
import { uniq } from 'lodash-es'
import { BehaviorSubject, combineLatest, firstValueFrom, map, switchMap } from 'rxjs'
import { ModelComponent } from '../model.component'

@UntilDestroy({ checkProperties: true })
@Component({
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    TranslateModule,
    UserRoleSelectComponent,
    UserProfileComponent,
    UserProfileInlineComponent,
    NxTableModule,
    ButtonGroupDirective,
    DensityDirective,
    AppearanceDirective,
    NgmSearchComponent
  ],
  selector: 'pac-model-members',
  templateUrl: 'members.component.html',
  styles: [
    `
      :host {
        width: 100%;
        overflow: auto;
      }
    `
  ]
})
export class ModelMembersComponent extends TranslationBaseComponent {
  userLabel = userLabel

  // Injectors
  private modelComponent = inject(ModelComponent)
  private modelsService = inject(ModelsService)
  private store = inject(Store)
  private route = inject(ActivatedRoute)

  searchControl = new FormControl()

  semanticModel: ISemanticModel
  members: { id: string; user: IUser; loading: boolean }[]
  get isOwner() {
    return this.store.user?.id === this.semanticModel?.ownerId
  }

  public readonly refresh$ = new BehaviorSubject<void>(null)

  private id$ = this.modelComponent.id$

  // Subscribers
  private _modelDetailSub = combineLatest([this.refresh$, this.id$])
    .pipe(switchMap(([, id]) => this.modelsService.getById(id ?? null, ['owner', 'members'])))
    .subscribe((semanticModel) => {
      this.semanticModel = semanticModel
      this.members = semanticModel.members.map((user) => ({
        id: user.id,
        user,
        loading: false
      }))
      this._cdr.detectChanges()
    })
  private _searchSub = this.searchControl.valueChanges
    .pipe(map((text) => text?.trim().toLowerCase()))
    .subscribe((text) => {
      this.members = (
        text
          ? this.semanticModel.members.filter(
              (member) =>
                member.email?.toLowerCase().includes(text) ||
                member.fullName?.toLowerCase().includes(text) ||
                member.firstName?.toLowerCase().includes(text) ||
                member.lastName?.toLowerCase().includes(text)
            )
          : this.semanticModel.members
      ).map((user) => ({
        id: user.id,
        user,
        loading: false
      }))
    })
  constructor(
    private _dialog: MatDialog,
    private _cdr: ChangeDetectorRef,
    private _toastrService: ToastrService
  ) {
    super()
  }

  async transferOwner() {
    const value = await firstValueFrom(
      this._dialog
        .open<UserRoleSelectComponent, any, { users: IUser[] }>(UserRoleSelectComponent, { data: { single: true } })
        .afterClosed()
    )
    const user = value?.users?.[0]
    if (user) {
      try {
        await firstValueFrom(this.modelsService.updateOwner(this.semanticModel.id, user.id, { relations: ['owner'] }))
        this.semanticModel.owner = user
        this.semanticModel.ownerId = user.id
        this._toastrService.success('PAC.Project.TransferOwnership', { Default: 'Transfer Ownership' })
      } catch (err) {
        this._toastrService.error(err)
      }
    }
  }

  async openMemberSelect() {
    const value = await firstValueFrom(
      this._dialog.open<UserRoleSelectComponent, any, { users: IUser[] }>(UserRoleSelectComponent).afterClosed()
    )
    if (value) {
      this.addMembers(value.users.map(({ id }) => id))
    }
  }

  async addMembers(members: string[]) {
    await firstValueFrom(
      this.modelsService.updateMembers(this.semanticModel.id, uniq([...members, ...this.members.map(({ id }) => id)]))
    )
    this.refresh$.next()
  }

  async removeMember(id: string) {
    const member = this.members.find((item) => item.id === id)
    member.loading = true
    await firstValueFrom(this.modelsService.deleteMember(this.semanticModel.id, id))
    this.refresh$.next()
  }
}
