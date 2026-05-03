import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouteReuseStrategy } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
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

@NgModule({
  declarations: [
    AppComponent,
    LoginPage,
    TabsPage,
    WardrobePage,
    AddItemPage,
    ItemDetailPage,
    BuilderPage,
    OutfitsPage,
    SettingsPage
  ],
  imports: [BrowserModule, HttpClientModule, FormsModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }],
  bootstrap: [AppComponent]
})
export class AppModule {}
