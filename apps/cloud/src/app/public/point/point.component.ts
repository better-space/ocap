import { ChangeDetectionStrategy, Component, ElementRef, Renderer2, computed, effect, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { NgmSmartFilterBarService } from '@metad/ocap-angular/core'
import { WasmAgentService } from '@metad/ocap-angular/wasm-agent'
import { AgentType, omit } from '@metad/ocap-core'
import { UntilDestroy } from '@ngneat/until-destroy'
import { StoryPointsService, convertStoryResult } from '@metad/cloud/state'
import { NxCoreService } from '@metad/core'
import { NxStoryService, getSemanticModelKey, prefersColorScheme } from '@metad/story/core'
import { NxStoryPointService } from '@metad/story/story'
import { BehaviorSubject, EMPTY } from 'rxjs'
import { catchError, distinctUntilChanged, filter, map, startWith, switchMap } from 'rxjs/operators'
import { registerStoryThemes, subscribeStoryTheme } from '../../@theme'
import { registerWasmAgentModel } from '../../@core'

@UntilDestroy({ checkProperties: true })
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'pac-public-point',
  templateUrl: 'point.component.html',
  styleUrls: ['point.component.scss'],
  host: {
    class: 'pac-public-point'
  },
  providers: [NxStoryService, NxStoryPointService, NgmSmartFilterBarService, NxCoreService]
})
export class PublicPointComponent {
  public storyService = inject(NxStoryService)
  private pointsService = inject(StoryPointsService)
  private coreService = inject(NxCoreService)
  private wasmAgent = inject(WasmAgentService)
  private route = inject(ActivatedRoute)
  private renderer = inject(Renderer2)
  private _elementRef = inject(ElementRef)

  public readonly pointId$ = this.route.params.pipe(
    startWith(this.route.snapshot.params),
    map((params) => params?.id),
    filter((id) => !!id),
    distinctUntilChanged()
  )

  public readonly storyPoint = toSignal(
    this.pointId$.pipe(
      switchMap((id) =>
        this.pointsService
          .getPublicOne(id, [
            'widgets',
            
            // 'story.model',
            // 'story.model.dataSource',
            // 'story.model.dataSource.type',
            // 'story.model.indicators',

            'story.models',
            'story.models.dataSource',
            'story.models.dataSource.type',
            'story.models.indicators',

            // 'story.points',
            'createdBy'
          ])
          .pipe(
            catchError((err) => {
              this.error$.next(err.error)
              return EMPTY
            })
          )
      )
    )
  )

  public readonly pointKey = computed(() => this.storyPoint()?.key)
  public readonly story = computed(() => {
    const point = this.storyPoint()
    if (!point) {
      return null
    }

    return convertStoryResult({
      ...point.story,
      points: [omit(point, 'story')]
    })
  })

  private readonly models = computed(() => this.story()?.models)

  public error$ = new BehaviorSubject(null)

  public readonly storySizeStyles = toSignal(this.storyService.storySizeStyles$)

  // System theme
  private prefersColorScheme$ = prefersColorScheme()
  private _themeSub = subscribeStoryTheme(this.storyService, this.coreService, this.renderer, this._elementRef)
  private _echartsThemeSub = registerStoryThemes(this.storyService)

  constructor() {
    effect(() => {
      if (this.story()) {
        this.storyService.setStory(this.story())
      }
    }, {allowSignalWrites: true})

    effect(() => {
      const models = this.models()
      models?.forEach((model) => {
        if (model?.agentType === AgentType.Wasm) {
          registerWasmAgentModel(this.wasmAgent, model)
        }
      })
    })
  }
}
