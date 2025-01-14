import { coerceBooleanProperty } from '@angular/cdk/coercion'
import { SelectionModel } from '@angular/cdk/collections'
import { ScrollingModule } from '@angular/cdk/scrolling'
import { CommonModule } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  ElementRef,
  Input,
  TemplateRef,
  computed,
  effect,
  forwardRef,
  inject,
  signal
} from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import {
  ControlValueAccessor,
  FormControl,
  FormsModule,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidatorFn
} from '@angular/forms'
import { MatAutocompleteModule } from '@angular/material/autocomplete'
import {
  CanColor,
  CanDisable,
  CanDisableRipple,
  mixinColor,
  mixinDisableRipple,
  mixinDisabled
} from '@angular/material/core'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { DisplayDensity, ISelectOption, OcapCoreModule } from '@metad/ocap-angular/core'
import { DisplayBehaviour } from '@metad/ocap-core'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { distinctUntilChanged, filter } from 'rxjs/operators'
import { NgmDisplayBehaviourComponent } from '../../display-behaviour'
import { NgmOptionContent } from '../../input/option-content'

@Component({
  standalone: true,
  selector: 'ngm-select',
  templateUrl: `select.component.html`,
  styleUrls: [`select.component.scss`],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ngm-select'
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: forwardRef(() => NgmSelectComponent)
    }
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatSelectModule,
    MatAutocompleteModule,
    MatInputModule,
    MatIconModule,
    ScrollingModule,

    TranslateModule,

    OcapCoreModule,
    NgmDisplayBehaviourComponent,
    NgmOptionContent
  ]
})
export class NgmSelectComponent
  extends mixinColor(
    mixinDisabled(
      mixinDisableRipple(
        class {
          constructor(public _elementRef: ElementRef) {}
        }
      )
    )
  )
  implements CanDisable, CanColor, CanDisableRipple, ControlValueAccessor
{
  private translateService = inject(TranslateService)

  @Input() displayBehaviour: DisplayBehaviour | string
  @Input() displayDensity: DisplayDensity | string
  @Input() valueKey = 'value'
  @Input() label: string
  @Input() placeholder: string
  @Input() get searchable(): boolean {
    return this._searchable
  }
  set searchable(value: boolean | string) {
    this._searchable = coerceBooleanProperty(value)
  }
  private _searchable = false
  @Input() virtualScroll: boolean

  @Input() validators: ValidatorFn | ValidatorFn[] | null

  @Input() get multiple(): boolean {
    return this._multiple
  }
  set multiple(value: boolean | string) {
    this._multiple = coerceBooleanProperty(value)
  }
  private _multiple = false

  @Input() get selectOptions() {
    return this.selectOptions$()
  }
  set selectOptions(options: Array<ISelectOption>) {
    this.selectOptions$.set(options)
  }
  private selectOptions$ = signal<Array<ISelectOption>>([])

  @ContentChild(NgmOptionContent, { read: TemplateRef, static: true })
  _explicitContent: TemplateRef<any> = undefined!

  formControl = new FormControl<string>(null)
  value = toSignal(this.formControl.valueChanges, { initialValue: '' })

  selection = new SelectionModel<string>(true)
  searchControl = new FormControl<string>(null)
  highlight = toSignal(this.searchControl.valueChanges, { initialValue: '' })

  readonly options$ = computed(() => {
    const text = this.highlight()?.trim().toLowerCase()
    if (text) {
      const terms = text.split(' ').filter((t) => !!t)
      return this.selectOptions.filter((option) => {
        const str = `${option.caption || option.label || ''}${option[this.valueKey]}`
        return terms.every((term) => str?.toLowerCase().includes(term))
      })
    }
    return this.selectOptions
  })

  public selectTrigger = computed(() => {
    return this.selectOptions?.find((option) => option[this.valueKey] === this.value())
  })

  autoInput = signal(null)

  onChange: (input: any) => void
  onTouched: () => void

  private valueSub = this.formControl.valueChanges
    .pipe(
      filter(() => !this.multiple),
      distinctUntilChanged(),
      takeUntilDestroyed()
    )
    .subscribe((value) => {
      this.onChange?.(value)
    })

  private selectionSub = this.selection.changed
    .pipe(
      filter(() => this.multiple),
      takeUntilDestroyed()
    )
    .subscribe(() => {
      this.onChange?.(this.selection.selected)
    })

  constructor(_elementRef: ElementRef) {
    super(_elementRef)
    effect(
      () => {
        this.autoInput.set(this.selectOptions.find((item) => item[this.valueKey] === this.value()))
      },
      { allowSignalWrites: true }
    )
  }

  writeValue(obj: any): void {
    this.formControl.setValue(obj)
  }
  registerOnChange(fn: any): void {
    this.onChange = fn
  }
  registerOnTouched(fn: any) {
    this.onTouched = fn
  }
  setDisabledState?(isDisabled: boolean): void {
    this.disabled = isDisabled
    isDisabled ? this.formControl.disable() : this.formControl.enable()
  }
  trackByValue(index: number, item) {
    return item?.value
  }

  displayWith(option: any) {
    return option?.caption || option?.label || option?.key || option?.value
  }

  onAutoInput(event: any) {
    if (typeof event === 'string') {
      this.searchControl.setValue(event)
    } else {
      this.formControl.setValue(event?.[this.valueKey])
      this.searchControl.setValue(null)
    }
  }

  onOptionSelected(event: any) {
    //
  }
}
