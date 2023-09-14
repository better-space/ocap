import { Platform } from '@angular/cdk/platform'
import { DOCUMENT } from '@angular/common'
import { ChangeDetectionStrategy, Component, Inject, OnInit, Renderer2 } from '@angular/core'
import { MatIconRegistry } from '@angular/material/icon'
import { DomSanitizer, Title } from '@angular/platform-browser'
import { TranslateService } from '@ngx-translate/core'
import { ThemesEnum } from '@metad/cloud/state'
import { NGXLogger } from 'ngx-logger'
import { combineLatest } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { ICONS, PACThemeService, Store, UpdateService } from './@core'
import { AppService } from './app.service'
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core'
import { DateFnsAdapter, MAT_DATE_FNS_FORMATS } from '@angular/material-date-fns-adapter'
import { enUS } from 'date-fns/locale';
import { zhCN } from 'date-fns/locale';
import { zhHK } from 'date-fns/locale';


function mapDateLocale(locale: string) {
  switch (locale) {
    case 'zh-CN':
    case 'zh-Hans':
    case 'zh':
      return zhCN
    case 'zh-Hant':
      return zhHK
    default:
      return enUS
  }
}


@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'pac-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  providers: [
    {
      provide: DateAdapter,
      useClass: DateFnsAdapter,
    },
    { provide: MAT_DATE_FORMATS, useValue: MAT_DATE_FNS_FORMATS },
  ]
})
export class AppComponent implements OnInit {

  constructor(
    private store: Store,
    public readonly appService: AppService,
    public readonly updateService: UpdateService,
    private readonly themeService: PACThemeService,
    private translate: TranslateService,
    private logger: NGXLogger,
    @Inject(DOCUMENT)
    private document: Document,
    private renderer: Renderer2,
    private matIconRegistry: MatIconRegistry,
    private domSanitizer: DomSanitizer,
    private platform: Platform,
    private title: Title,
    private _adapter: DateAdapter<any>
  ) {
    translate.setDefaultLang('en')
    // the lang to use, if the lang isn't available, it will use the current loader to get them
    translate.use(this.store.preferredLanguage || navigator.language || 'en')
    this.document.documentElement.lang = translate.currentLang

    this.store.preferredLanguage$.pipe(filter(value => !!value)).subscribe((language) => {
      this.translate.use(language)
      this.document.documentElement.lang = language
      this._adapter.setLocale(mapDateLocale(language))
    })

    this.translate.stream('PAC.Title').subscribe((title) => this.title.setTitle(title))

    ICONS.forEach((icon) => {
      this.matIconRegistry.addSvgIcon(icon.name, this.domSanitizer.bypassSecurityTrustResourceUrl(icon.resourceUrl))
    })
  }

  ngOnInit() {
    combineLatest([
      this.appService.isMobile$,
      this.store.preferredTheme$.pipe(
        map((theme) => `nx-theme-${theme ?? ThemesEnum.default}`))
    ])
    .subscribe(([isMobile, theme]) => {
      // for body
      const body = this.document.getElementsByTagName('body')[0]
      const bodyThemeRemove = Array.from(body.classList).filter((item: string) => item.includes('-theme'))
      if (bodyThemeRemove.length) {
        body.classList.remove(...bodyThemeRemove)
      }
      theme.split(' ').forEach((value) => {
        this.renderer.addClass(body, value)
      })

      if (isMobile && (this.platform.IOS || this.platform.ANDROID) ) {
        this.renderer.addClass(body, 'mobile')
      } else {
        body.classList.remove('mobile')
      }
    })
  }

}
