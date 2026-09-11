import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouteReuseStrategy } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { LazyImageDirective } from './lazy-image.directive';
import {
  AddItemPage,
  AnalyticsPage,
  BuilderPage,
  ItemDetailPage,
  LoginPage,
  OnboardingPage,
  GettingStartedPage,
  OutfitsPage,
  SettingsPage,
  TabsPage,
  WardrobePage
} from './pages';

@NgModule({
  declarations: [
    AppComponent,
    LazyImageDirective,
    LoginPage,
    OnboardingPage,
    GettingStartedPage,
    TabsPage,
    WardrobePage,
    AddItemPage,
    ItemDetailPage,
    BuilderPage,
    OutfitsPage,
    SettingsPage,
    AnalyticsPage
  ],
  imports: [BrowserModule, HttpClientModule, FormsModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }],
  bootstrap: [AppComponent]
})
export class AppModule {}
