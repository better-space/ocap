import { Component, ElementRef, forwardRef, Input, ViewChild } from '@angular/core'
import { ControlValueAccessor, FormGroup, NG_VALUE_ACCESSOR } from '@angular/forms'
import { ITag, IUser } from '@metad/contracts'
import { FormlyFieldConfig } from '@ngx-formly/core'
import { AuthService } from '@metad/cloud/state'
import { firstValueFrom, map } from 'rxjs'
import { LANGUAGES, MatchValidator, RoleService, Store } from '../../../../@core'
import { TranslationBaseComponent } from '../../../language/translation-base.component'

@Component({
  selector: 'pac-user-basic-info-form',
  templateUrl: 'basic-info-form.component.html',
  styleUrls: ['basic-info-form.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: forwardRef(() => BasicInfoFormComponent)
    }
  ]
})
export class BasicInfoFormComponent extends TranslationBaseComponent implements ControlValueAccessor {
  UPLOADER_PLACEHOLDER = 'FORM.PLACEHOLDERS.UPLOADER_PLACEHOLDER'

  @ViewChild('imagePreview')
  imagePreviewElement: ElementRef

  @Input() public password: boolean
  @Input() public isEmployee: boolean
  @Input() public isCandidate: boolean
  @Input() public isAdmin = false
  @Input() public isSuperAdmin = false
  @Input() public createdById: string
  @Input() public selectedTags: ITag[]

  private readonly roles$ = this.roleService.getAll().pipe(map(({ items }) => items))

  //Fields for the form
  public form = new FormGroup({})
  model = {} as any
  fields: FormlyFieldConfig[] = []

  onChange: (value: any) => any
  constructor(
    private readonly store: Store,
    private readonly roleService: RoleService,
    private readonly authService: AuthService,
  ) {
    super()
  }

  writeValue(obj: any): void {
    if (obj) {
      this.form.patchValue(obj)
      this.model = obj
    }
  }
  registerOnChange(fn: any): void {
    this.onChange = fn
  }
  registerOnTouched(fn: any): void {}
  setDisabledState?(isDisabled: boolean): void {}

  ngOnInit() {
    const TRANSLATES = this.getTranslation('PAC.SHARED.USER_BASIC')

    const password = this.password
      ? [
          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'password',
            type: 'input',
            props: {
              label: TRANSLATES?.Passwrod ?? 'Passwrod',
              placeholder: '',
              type: 'password',
              appearance: 'fill'
            }
          },
          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'confirmPassword',
            type: 'input',
            props: {
              label: TRANSLATES?.RepeatPasswrod ?? 'Repeat Passwrod',
              placeholder: '',
              type: 'password',
              appearance: 'fill'
            }
          }
        ]
      : []
    this.fields = [
      {
        fieldGroupClassName: 'nx-formly__row',
        fieldGroup: [
          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'firstName',
            type: 'input',
            props: {
              label: TRANSLATES?.firstName ?? 'First Name (optional)',
              placeholder: '',
              appearance: 'fill'
            }
          },
          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'lastName',
            type: 'input',
            props: {
              label: TRANSLATES?.lastName ?? 'Last Name (optional)',
              placeholder: '',
              appearance: 'fill'
            }
          },

          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'username',
            type: 'input',
            props: {
              label: TRANSLATES?.Username ?? 'Username',
              required: true,
              appearance: 'fill'
            }
          },
          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'email',
            type: 'input',
            props: {
              label: TRANSLATES?.Email ?? 'Email',
              placeholder: '',
              required: true,
              appearance: 'fill'
            }
          },
          ...password,
          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'roleId',
            type: 'select',
            props: {
              label: TRANSLATES?.Role ?? 'Role',
              placeholder: '',
              required: true,
              disabled: !this.isSuperAdmin && !this.isAdmin,
              valueProp: 'id',
              labelProp: 'name',
              options: this.roles$,
              appearance: 'fill'
            }
          },
          {
            className: 'nx-formly__col nx-formly__col-6',
            key: 'preferredLanguage',
            type: 'select',
            props: {
              label: TRANSLATES?.PreferredLanguage ?? 'Preferred Language',
              placeholder: '',
              options: LANGUAGES,
              appearance: 'fill'
            }
          }
        ],
        validators: {
          validation: this.password ? [ MatchValidator.mustMatch('password', 'repeatPassword') ] : []
        }
      },
      {
        className: 'nx-formly__col nx-formly__col-6',
        key: 'imageUrl',
        type: 'input',
        props: {
          label: TRANSLATES?.ImageURL ?? 'Image URL (optional)',
          placeholder: 'Image',
          appearance: 'fill'
        }
      }
    ]
  }

  onFormChange(model: any) {
    this.onChange?.(model)
  }

  async registerUser(organizationId?: string, createdById?: string) {
    if (this.form.valid) {
      const { tenant } = this.store.user
      const user: IUser = {
        ...this.model,
        tenantId: tenant.id
      }

      return await firstValueFrom(
        this.authService.register({
          user,
          password: this.model.password,
          confirmPassword: this.model.confirmPassword,
          organizationId,
          createdById
        })
      )
    }

    return null
  }
}
