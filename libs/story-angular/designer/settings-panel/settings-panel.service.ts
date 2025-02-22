import { ComponentPortal } from '@angular/cdk/portal'
import { Injectable, Injector, ViewContainerRef, effect, inject, signal } from '@angular/core'
import { cloneDeep } from '@metad/ocap-core'
import { uuid } from '@metad/story/core'
import { NGXLogger } from 'ngx-logger'
import { BehaviorSubject, combineLatest, EMPTY, from, Observable, of, Subject } from 'rxjs'
import { distinctUntilChanged, filter, map, startWith, switchMap, takeUntil, tap } from 'rxjs/operators'
import {
  DesignerComponentProvider,
  DesignerComponentType,
  SettingsComponent,
  STORY_DESIGNER_COMPONENT,
  STORY_DESIGNER_FORM,
  STORY_DESIGNER_LIVE_MODE,
  STORY_DESIGNER_SCHEMA
} from '../types'

interface LocalSettingsComponent extends SettingsComponent {
  components: Array<DesignerComponentType<unknown>>
  settingsPortals?: ComponentPortal<unknown> | Array<{ icon?: string; label: string; portal: ComponentPortal<unknown> }>
  drawer?: boolean
  liveMode?: boolean
  title?: string
}

@Injectable()
export class NxSettingsPanelService {

  private _viewContainerRef = inject(ViewContainerRef)
  protected injector = inject(Injector)
  private components?: Array<DesignerComponentProvider> = inject(STORY_DESIGNER_COMPONENT, {optional: true})
  protected logger? = inject(NGXLogger, {optional: true})

  // public readonly opened$ = signal(false)
  
  liveMode: boolean

  drawerSubmit$ = new Subject<boolean>()

  private _settingsComponents: { [key: string]: LocalSettingsComponent } = {}

  private _editable$ = new BehaviorSubject<boolean>(false)
  public readonly editable$ = this._editable$.asObservable().pipe(distinctUntilChanged())

  get settingsComponent() {
    return this._settingsComponent$.value
  }
  private _settingsComponent$ = new BehaviorSubject<LocalSettingsComponent>(null)
  public settingsComponent$ = combineLatest([this._settingsComponent$, this._editable$]).pipe(
    filter(([, editable]) => editable),
    map(([settingsComponent]) => {
      if (!settingsComponent) {
        return null
      }

      // if (!settingsComponent.settingsPortals) {
      //   if (settingsComponent.components) {
      //     settingsComponent.settingsPortals = settingsComponent.components.map(
      //       ({ icon, label, component, schema, model, submit }) => {
      //         const injector = Injector.create({
      //           providers: [
      //             [
      //               {
      //                 provide: STORY_DESIGNER_FORM,
      //                 useValue: {
      //                   model,
      //                   submit
      //                 }
      //               }
      //             ]
      //           ],
      //           parent: this.injector
      //         })

      //         const injector2 = Injector.create({
      //           providers: [
      //             [
      //               ...(schema ? [
      //                 {
      //                   provide: STORY_DESIGNER_SCHEMA,
      //                   useClass: schema
      //                 }
      //               ] : []),
      //               {
      //                 provide: STORY_DESIGNER_LIVE_MODE,
      //                 useValue: settingsComponent.liveMode ?? this.liveMode
      //               }
      //             ]
      //           ],
      //           parent: injector
      //         })

      //         return {
      //           icon,
      //           label,
      //           portal: new ComponentPortal(component, null, injector2)
      //         }
      //       }
      //     )
      //   } else {
      //     const injector = Injector.create({
      //       providers: [
      //         [
      //           {
      //             provide: STORY_DESIGNER_FORM,
      //             useValue: settingsComponent
      //           }
      //         ]
      //       ],
      //       parent: this.injector
      //     })

      //     const injector2 = Injector.create({
      //       providers: [
      //         [
      //           ...(settingsComponent.schema ? [
      //             {
      //               provide: STORY_DESIGNER_SCHEMA,
      //               useClass: settingsComponent.schema
      //             }
      //           ] : []),
      //           {
      //             provide: STORY_DESIGNER_LIVE_MODE,
      //             useValue: settingsComponent.liveMode ?? this.liveMode
      //           }
      //         ]
      //       ],
      //       parent: injector
      //     })

      //     settingsComponent.settingsPortals = new ComponentPortal(
      //       settingsComponent.container,
      //       this._viewContainerRef,
      //       injector2
      //     )
      //   }
      // }

      this._settingsComponents[settingsComponent.id] = settingsComponent
      return this._settingsComponents[settingsComponent.id]
    })
  )

  public readonly close$ = new Subject<void>()
  public readonly closeMinor$ = new Subject<void>()

  setEditable(value: boolean) {
    this._editable$.next(value)
  }

  observe(componentType: any) {
    const componentProvider = this.components.find((item) => item.type === componentType)

    if (!componentProvider) {
      console.error(`Can't found componentProvider for ${componentType}`)
      return EMPTY
    }

    return of(componentProvider).pipe(
      switchMap((componentProvider) => {
        if (componentProvider.schema) {
          return of(componentProvider.schema)
        }
        if (componentProvider.factory) {
          return from(componentProvider.factory())
        }

        return of(null)
      }),
      map((schema) => ({
        ...componentProvider,
        schema
      })),
    )
  }

  openDesigner<T>(componentType: any, model: T | Observable<T>, id?: string): Observable<T> {
    const componentProvider = this.components.find((item) => item.type === componentType)

    if (!componentProvider) {
      console.error(`Can't found componentProvider for ${componentType}`)
      return EMPTY
    }

    return of(componentProvider).pipe(
      switchMap((componentProvider) => {
        if (componentProvider.schema) {
          return of(componentProvider.schema)
        }
        if (componentProvider.factory) {
          return from(componentProvider.factory())
        }

        return of(null)
      }),
      map((schema) => ({
        ...componentProvider,
        schema
      })),
      switchMap((componentProvider) => {
        const settingsComponent =
          this._settingsComponents[id] ||
          ({
            id: id || uuid(),
            container: componentProvider.component,
            schema: componentProvider.schema,
            submit: new Subject<T>(),
            liveMode: this.liveMode
          } as LocalSettingsComponent)

        settingsComponent.model = model

        this._settingsComponent$.next(settingsComponent)

        return settingsComponent.submit.pipe(map((model) => cloneDeep(model)))
      })
    )
  }

  /**
   * model 必须提供初始值(非 null)才行. 这个需要修正
   * 
   * @param id
   * @param tabs
   * @returns 
   */
  openTabsDesigner<T>(id: string, tabs: Array<DesignerComponentType<any>>) {
    return (
      this._settingsComponents[id]
        ? of(this._settingsComponents[id])
        : combineLatest(
            tabs.map(({ componentType, label, icon, model }, i) => {
              return this.observe(componentType).pipe(
                map((componentProvider) => ({
                  icon: componentProvider.icon ?? icon,
                  label,
                  component: componentProvider.component,
                  model,
                  schema: componentProvider.schema,
                  submit: new Subject()
                }))
              )
            })
          ).pipe(
            map((components) => {
              return {
                id: id || uuid(),
                components,
                liveMode: this.liveMode
              } as LocalSettingsComponent
            })
          )
    ).pipe(
      tap((settingsComponent) => {
        this._settingsComponent$.next(settingsComponent)
      }),
      switchMap(({ components }) =>
        combineLatest(
          components.map(({ submit }) => {
            return submit.pipe(
              startWith(null),
              map((model) => cloneDeep(model))
            )
          })
        )
      )
    ) as Observable<any>
  }

  /**
   *
   * @param componentType
   * @param model
   * @param title
   * @returns
   */
  openSecondDesigner<T>(componentType: string, model: T, title?: string, liveMode?: boolean): Observable<T> {
    // 终止之前所有的次设计器
    this.closeMinor$.next()
    return this.observe(componentType).pipe(
      switchMap((componentProvider) => {
        const settingsComponent = {
          id: uuid(),
          container: componentProvider.component,
          schema: componentProvider.schema,
          submit: new Subject<T>(),
          drawer: true,
          liveMode: true,
          transition: null,
          title
        } as LocalSettingsComponent

        settingsComponent.model = model

        this._settingsComponent$.next(settingsComponent)

        return settingsComponent.submit.pipe(
          startWith(null),
          switchMap((model) => {
            return liveMode
              ? this.drawerSubmit$.pipe(
                  startWith(null),
                  map((clear) => {
                    // 实际的 Model 值要放在对象里, 以此与 null 分开来判断是否是删除当前值
                    return clear ? {} : cloneDeep(model)
                  })
                )
              : this.drawerSubmit$.pipe(
                  map((clear) => {
                    // 实际的 Model 值要放在对象里, 以此与 null 分开来判断是否是删除当前值
                    return clear ? {} : cloneDeep(model)
                  })
                )
          }),
          // 终止设计器
          takeUntil(this.closeMinor$)
        )
      })
    )
  }

  close() {
    this.close$.next()
  }
}
