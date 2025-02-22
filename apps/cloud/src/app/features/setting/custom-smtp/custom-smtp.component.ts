import { Component, inject } from '@angular/core'
import { UntilDestroy } from '@ngneat/until-destroy'
import { distinctUntilChanged, map } from 'rxjs'
import { Store } from '../../../@core'
import { TranslationBaseComponent } from '../../../@shared'

@UntilDestroy({ checkProperties: true })
@Component({
  selector: 'pac-tenant-custom-smtp',
  templateUrl: './custom-smtp.component.html',
  styleUrls: ['./custom-smtp.component.scss']
})
export class CustomSmtpComponent extends TranslationBaseComponent {
  private readonly store = inject(Store)

  public readonly organiztionName$ = this.store.selectedOrganization$.pipe(
    map((org) => org?.name),
    distinctUntilChanged()
  )
}
