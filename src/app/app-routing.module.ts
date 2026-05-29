import { NgModule } from '@angular/core';
import { CanActivateFn, Router, RouterModule, Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  AddItemPage,
  BuilderPage,
  ItemDetailPage,
  LoginPage,
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

const routes: Routes = [
  { path: 'login', component: LoginPage },
  {
    path: 'tabs',
    component: TabsPage,
    canActivate: [requireSession],
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
