import { ChangeDetectionStrategy, Component, Inject, ViewEncapsulation } from '@angular/core';
import { MatSnackBarRef, MAT_SNACK_BAR_DATA } from '@angular/material/snack-bar';

/**
 * Interface for a simple snack bar component that has a message and a single action.
 */
 export interface ConfirmActionSnackBar {
    data: {message: string; action: string};
    snackBarRef: MatSnackBarRef<ConfirmActionSnackBar>;
    action: () => void;
    hasAction: boolean;
  }

  
@Component({
    selector: 'pac-confirm-snackbar',
    template: `<span class="flex-1 flex">{{data.message}}</span>
    <div class="pac-confirm-snackbar-action">
      <button mat-button (click)="dismiss()">
        {{ 'COMPONENTS.COMMON.CANCEL' | translate: {Default: 'Cancel'} }}
      </button>
    </div>
    <div class="pac-confirm-snackbar-action" *ngIf="hasAction">
      <button mat-button color="accent" (click)="action()">{{data.action}}</button>
    </div>`,
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
      'class': 'pac-confirm-snackbar',
    },
    styleUrls: ['./confirm-snack-bar.scss']
})
export class ConfirmSnackBar implements ConfirmActionSnackBar {

    /** Data that was injected into the snack bar. */
  data: {message: string; action: string};

  constructor(
    public snackBarRef: MatSnackBarRef<ConfirmActionSnackBar>,
    @Inject(MAT_SNACK_BAR_DATA) data: any,
  ) {
    this.data = data;
  }

  dismiss(): void {
    this.snackBarRef.dismiss()
  }

  /** Performs the action on the snack bar. */
  action(): void {
    this.snackBarRef.dismissWithAction();
  }

  /** If the action button should be shown. */
  get hasAction(): boolean {
    return !!this.data.action;
  }
}