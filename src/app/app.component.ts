import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { WardrobeApiService } from './wardrobe-api.service';

@Component({
  selector: 'app-root',
  standalone: false,
  template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>'
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  private sessionSubscription: Subscription | null = null;
  private readonly onlineListener = () => this.handleNetworkStatus(true);
  private readonly offlineListener = () => this.handleNetworkStatus(false);

  async ngOnInit(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#f7efe6' });
      } catch {
        // Status bar configuration is best-effort.
      }
    }

    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);
    this.handleNetworkStatus(typeof navigator !== 'undefined' ? navigator.onLine : true);

    await this.auth.restore();
    this.sessionSubscription = this.auth.session$.subscribe((session) => {
      if (!session && (this.router.url.startsWith('/tabs') || this.router.url.startsWith('/onboarding'))) {
        void this.router.navigateByUrl('/login');
        return;
      }

      if (session && (this.router.url === '/login' || this.router.url === '/')) {
        void this.router.navigateByUrl(this.auth.hasCompletedPersonalDetails ? '/tabs/wardrobe' : '/onboarding');
        return;
      }

      if (session && !this.auth.hasCompletedPersonalDetails && this.router.url.startsWith('/tabs')) {
        void this.router.navigateByUrl('/onboarding');
      }
    });

    if (!this.auth.session) {
      if (!this.router.url.startsWith('/login') && !this.router.url.startsWith('/reset-password')) {
        await this.router.navigateByUrl('/login');
      }
      return;
    }

    if (this.router.url === '/login' || this.router.url === '/') {
      await this.router.navigateByUrl(this.auth.hasCompletedPersonalDetails ? '/tabs/wardrobe' : '/onboarding');
      return;
    }

    if (!this.auth.hasCompletedPersonalDetails && this.router.url.startsWith('/tabs')) {
      await this.router.navigateByUrl('/onboarding');
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onlineListener);
    window.removeEventListener('offline', this.offlineListener);
    this.sessionSubscription?.unsubscribe();
  }

  private handleNetworkStatus(isOnline: boolean): void {
    this.api.setOnlineStatus(isOnline);
  }
}
