import { Directive, EventEmitter, Input, OnDestroy, Output } from '@angular/core'
import { ControlValueAccessor } from '@angular/forms'
import { BehaviorSubject, Observable, Observer, Subject, Subscription } from 'rxjs'
import { debounceTime, filter, map, switchMap } from 'rxjs/operators'

declare var monaco: any


@Directive({
  selector: '[nxEditor]',
})
export class BaseEditorDirective implements ControlValueAccessor, OnDestroy {

  // CodeEditor
  get editor() {
    return this.editor$.value
  }
  protected editor$ = new BehaviorSubject<any>(null)

  // CodeEditor options
  @Input() get options() {
    return this._options$.value
  }
  set options(value) {
    this._options$.next(value)
  }
  private _options$ = new BehaviorSubject({})

  @Input() textSelection: string

  @Input() actions: any[] = []

  @Output() keyDown = this.editor$.pipe(
    filter(Boolean),
    switchMap(monacoKeydown),
  )

  languageId: string
  private defaultOptions = {
    theme: 'vs',
    automaticLayout: true,
  }
  public editorOptions$ = this._options$.pipe(
    map((options) => ({ language: this.languageId,
      ...this.defaultOptions,
      ...(options ?? {})
    }))
  )

  code = ''

  private _modelChange$ = new Subject<any>()
  @Output() modelChange = this._modelChange$.pipe(debounceTime(500))
  // @Output() textSelectionChange = new EventEmitter<string>()
  @Output() selectionChange = new EventEmitter<{range: any, text: string}>()

  private cursorSelection$ = new Subject()

  protected _providers = []
  protected _onChange: any
  
  constructor() {
    this.modelChange.subscribe(model => {
      this.onChange(this.code)
    })

    this.cursorSelection$.pipe(debounceTime(300)).subscribe((e) => {
      // this.textSelectionChange.emit(this.getSelectText())
      this.selectionChange.emit({range: this.editor.getSelection(), text: this.getSelectText()})
    })
  }

  onModelChange(event) {
    this._modelChange$.next(event)
  }
  onChange(event) {
    this._onChange?.(this.code)
  }
  writeValue(obj: any): void {
    this.code = obj
  }
  registerOnChange(fn: any): void {
    this._onChange = fn
  }
  registerOnTouched(fn: any): void {
    //
  }
  setDisabledState?(isDisabled: boolean): void {
    isDisabled ? this.editor?.updateOptions({ readOnly: true }) : this.editor?.updateOptions({ readOnly: false })
  }

  onInit(editor: any) {
    this.editor$.next(editor)
    this.editor.onDidChangeCursorSelection((e) => {
      this.cursorSelection$.next(e)
    })

    // 用于控制切换该菜单键的显示
    const shouldShowSqlRunnerAction = editor.createContextKey('shouldShowSqlRunnerAction', true);
    this.actions?.forEach((action) => {
      const { id, label, action: runFn } = action;
      editor.addAction({
        id,
        label: label(),
        // 控制该菜单键显示
        precondition: 'shouldShowSqlRunnerAction',
        // 该菜单键位置
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        // 点击该菜单键后运行
        run: (event: any) => {
          const selectedText = editor.getModel()?.getValueInRange(editor.getSelection()!) || '';
          runFn(selectedText, {selection: editor.getSelection()});
        },
      });
    })
  }

  onResized(event) {
    this.editor?.layout()
  }

  dispose() {
    this._providers.forEach((provider) => provider.dispose())
  }

  formatDocument() {
    this.editor?.getAction('editor.action.formatDocument').run()
    // this.editor?.trigger("editor", "editor.action.formatDocument", "")
  }

  formatSelection() {
    this.editor?.getAction('editor.action.formatSelection').run()
    // this.editor?.trigger("editor", "editor.action.formatSelection", "")
  }

  compressDocument() {
    this.code = this.code.replace(/\r\n/g, ' ')
    this.code = this.code.split(' ').filter((value) => !!value).join(' ')
  }

  clearDocument() {
    this.code = ''
  }

  startFindAction() {
    this.editor.getAction('actions.find').run()
  }

  startFindReplaceAction() {
    this.editor.getAction('editor.action.startFindReplaceAction').run()
  }

  insert(text: string, position?: any) {
    if (position) {
      this.editor.setPosition(position)
    }
    this.editor?.trigger('keyboard', 'type', {text: text});
  }

  undo() {
    this.editor.trigger("myeditor", "undo");
  }
  redo() {
    this.editor.trigger("myeditor", "redo");
  }

  getSelectText() {
    return this.editor?.getModel()?.getValueInRange(this.editor.getSelection())
  }

  appendText(text: string) {
    const lastLine = this.editor.getModel().getLineCount();
    const lastLineText = this.editor.getModel().getLineContent(lastLine);
    const lastLineLength = lastLineText.length;

    this.editor.getModel().pushEditOperations(
      [],
      [{
        range: new monaco.Range(lastLine, lastLineLength + 1, lastLine, lastLineLength + 1),
        text
      }],
      () => null
    );
  }

  applyEdits(edits: any[]) {
    // Apply the edit to the editor's model
    this.editor.getModel().applyEdits(edits)
  }

  ngOnDestroy(): void {
    this.dispose()
  }
}

function monacoKeydown(editor: any /* monaco.editor.IStandaloneCodeEditor */): Observable<void> {
  return new Observable((observer: Observer<void>) => {
    const listener = editor.onKeyDown((event) => {
      observer.next(event)
    })
    return new Subscription(() => listener.dispose())
  })
}
