import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-root',
  standalone: false,
  template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>'
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private sessionSubscription: Subscription | null = null;

  async ngOnInit(): Promise<void> {
    await this.auth.restore();
    this.sessionSubscription = this.auth.session$.subscribe((session) => {
      if (!session && this.router.url.startsWith('/tabs')) {
        void this.router.navigateByUrl('/login');
      }
    });

    if (!this.auth.session) {
      await this.router.navigateByUrl('/login');
    }
  }

  ngOnDestroy(): void {
    this.sessionSubscription?.unsubscribe();
  }
}
