import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, RouterLink } from '@angular/router';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { IonicModule } from '@ionic/angular';
import { AuthService } from '../../auth.service';
import { OutfitDto, WardrobeItemDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { GettingStartedPage } from './getting-started.page';

describe('Getting started', () => {
  let page: GettingStartedPage;
  let api: jasmine.SpyObj<WardrobeApiService>;
  let auth: { session: { user: { id: string } } };

  beforeEach(() => {
    api = jasmine.createSpyObj('WardrobeApiService', ['getItems', 'getOutfits']);
    api.getItems.and.resolveTo([]);
    api.getOutfits.and.resolveTo([]);
    auth = { session: { user: { id: 'user-1' } } };
    TestBed.configureTestingModule({
      declarations: [GettingStartedPage],
      imports: [CommonModule, IonicModule.forRoot(), RouterTestingModule],
      providers: [GettingStartedPage, { provide: WardrobeApiService, useValue: api }, { provide: AuthService, useValue: auth }]
    });
    page = TestBed.inject(GettingStartedPage);
  });

  it('starts new users with no completed actions', async () => {
    await page.ionViewWillEnter();
    expect(page.progress).toEqual({ hasItems: false, hasOutfits: false, hasWornOutfit: false });
  });

  it('returns help to the screen that opened it and rejects unrelated destinations', () => {
    const route = TestBed.inject(ActivatedRoute);
    const params = spyOnProperty(route.snapshot, 'queryParamMap', 'get');
    for (const returnUrl of ['/tabs/builder', '/tabs/settings']) {
      params.and.returnValue(convertToParamMap({ returnUrl }));
      expect(page.returnUrl).toBe(returnUrl);
    }
    params.and.returnValue(convertToParamMap({ returnUrl: 'https://example.com' }));
    expect(page.returnUrl).toBe('/tabs/wardrobe');
  });

  it('derives progress from active clothes, saved looks and actual wear counts', async () => {
    api.getItems.and.resolveTo([{ isArchived: true, isDeleted: false }, { isArchived: false, isDeleted: true }] as WardrobeItemDto[]);
    api.getOutfits.and.resolveTo([{ wearCount: 0 }] as OutfitDto[]);
    await page.loadProgress();
    expect(page.progress).toEqual({ hasItems: false, hasOutfits: true, hasWornOutfit: false });
    api.getItems.and.resolveTo([{ isArchived: false, isDeleted: false }] as WardrobeItemDto[]);
    api.getOutfits.and.resolveTo([{ wearCount: 1 }] as OutfitDto[]);
    await page.ionViewWillEnter();
    expect(page.progress).toEqual({ hasItems: true, hasOutfits: true, hasWornOutfit: true });
  });

  it('keeps progress unknown on failure and recovers on retry', async () => {
    api.getItems.and.rejectWith({ status: 0 });
    await page.loadProgress();
    expect(page.progress).toBeNull();
    expect(page.message).not.toBe('');
    api.getItems.and.resolveTo([]);
    await page.loadProgress();
    expect(page.message).toBe('');
    expect(page.progress?.hasItems).toBeFalse();
  });

  it('ignores an older response after a retry, navigation or account change', async () => {
    let finish!: (items: WardrobeItemDto[]) => void;
    api.getItems.and.returnValue(new Promise((resolve) => { finish = resolve; }));
    const oldLoad = page.loadProgress();
    api.getItems.and.resolveTo([]);
    await page.loadProgress();
    finish([{ isArchived: false }] as WardrobeItemDto[]);
    await oldLoad;
    expect(page.progress?.hasItems).toBeFalse();

    api.getItems.and.returnValue(new Promise((resolve) => { finish = resolve; }));
    const leaving = page.loadProgress();
    page.ionViewWillLeave();
    auth.session.user.id = 'user-2';
    finish([{ isArchived: false }] as WardrobeItemDto[]);
    await leaving;
    expect(page.progress).toBeNull();
    expect(page.isLoading).toBeFalse();
  });

  it('renders useful guidance and working route targets even when progress cannot load', async () => {
    await TestBed.compileComponents();
    api.getOutfits.and.rejectWith(new Error('Unavailable'));
    const fixture = TestBed.createComponent(GettingStartedPage);
    await fixture.componentInstance.loadProgress();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Add your clothes');
    expect(fixture.nativeElement.querySelectorAll('details').length).toBe(4);
    const router = TestBed.inject(Router);
    const routes = fixture.debugElement.queryAll(By.directive(RouterLink))
      .map((element) => router.serializeUrl(element.injector.get(RouterLink).urlTree!));
    expect(routes).toEqual(['/tabs/wardrobe', '/tabs/add', '/tabs/builder', '/tabs/outfits', '/tabs/settings']);
    expect(fixture.nativeElement.querySelector('.step-status')).toBeNull();
    fixture.destroy();
  });
});
