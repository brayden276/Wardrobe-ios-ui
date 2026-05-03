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
      { path: 'wardrobe', component: WardrobePage },
      { path: 'wardrobe/:id', component: ItemDetailPage },
      { path: 'add', component: AddItemPage },
      { path: 'outfits', component: OutfitsPage },
      { path: 'builder', component: BuilderPage },
      { path: 'settings', component: SettingsPage },
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
