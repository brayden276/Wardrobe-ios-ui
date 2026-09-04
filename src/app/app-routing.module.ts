import { NgModule } from '@angular/core';
import { CanActivateFn, Router, RouterModule, Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  AddItemPage,
  AnalyticsPage,
  BuilderPage,
  ItemDetailPage,
  LoginPage,
  OnboardingPage,
  OutfitsPage,
  SettingsPage,
  TabsPage,
  WardrobePage
} from './pages';

const requireSession: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  return auth.session ? true : router.parseUrl('/login');
};

const requireNoSession: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  if (!auth.session) {
    return true;
  }

  return auth.hasCompletedPersonalDetails
    ? router.parseUrl('/tabs/wardrobe')
    : router.parseUrl('/onboarding');
};

const requireCompletedPersonalDetails: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  if (!auth.session) {
    return router.parseUrl('/login');
  }

  return auth.hasCompletedPersonalDetails ? true : router.parseUrl('/onboarding');
};

const routes: Routes = [
  { path: 'login', component: LoginPage, canActivate: [requireNoSession] },
  { path: 'onboarding', component: OnboardingPage, canActivate: [requireSession] },
  {
    path: 'tabs',
    component: TabsPage,
    canActivate: [requireCompletedPersonalDetails],
    children: [
      {
        path: 'wardrobe',
        children: [
          { path: '', component: WardrobePage, pathMatch: 'full' },
          { path: ':id', component: ItemDetailPage }
        ]
      },
      { path: 'add', children: [{ path: '', component: AddItemPage }] },
      { path: 'outfits', children: [{ path: '', component: OutfitsPage }] },
      { path: 'builder', children: [{ path: '', component: BuilderPage }] },
      { path: 'analytics', children: [{ path: '', component: AnalyticsPage }] },
      { path: 'settings', children: [{ path: '', component: SettingsPage }] },
      { path: '', redirectTo: 'wardrobe', pathMatch: 'full' }
    ]
  },
  { path: '', redirectTo: 'tabs/wardrobe', pathMatch: 'full' },
  { path: '**', redirectTo: 'tabs/wardrobe' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
