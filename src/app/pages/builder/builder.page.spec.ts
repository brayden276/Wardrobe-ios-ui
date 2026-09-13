import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';
import { LazyImageDirective } from '../../lazy-image.directive';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { GeneratedOutfitDto, OutfitDto, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { BuilderPage } from './builder.page';

describe('Builder first use', () => {
  let page: BuilderPage;
  let api: jasmine.SpyObj<WardrobeApiService>;
  const lookups: WardrobeLookupsDto = {
    categories: [], colours: [], patterns: [], visibleMaterials: [], necklines: [], sleeveLengths: [],
    fits: [], garmentLengths: [], bottomShapes: [], rises: [], occasions: [], formalities: []
  };
  const item = (id: string, categoryId: string): WardrobeItemDto => ({
    id, name: id, categoryId, subcategoryId: '', primaryColourId: '', secondaryColourIds: [],
    patternId: null, visibleMaterialId: null, necklineId: null, sleeveLengthId: null, fitId: null,
    lengthId: null, bottomShapeId: null, riseId: null, isArchived: false, isDeleted: false,
    wearCount: 0, lastWornAt: null, imageGenerationStatus: null,
    image: { originalUrl: '', displayUrl: '', canonicalUrl: null, thumbnailUrl: null },
    createdAt: '2026-09-01', updatedAt: '2026-09-01'
  });


  const suggestion: GeneratedOutfitDto = {
    title: 'Everyday look', itemIds: ['Top'], explanation: 'Comfortable layers', imageUrl: null,
    isComplete: false, missingCategories: ['shoes'], relaxedConstraints: []
  };
  const saved: OutfitDto = {
    id: 'saved-1', name: suggestion.title, prompt: 'Everyday', explanation: suggestion.explanation,
    items: [], imageUrl: null, thumbnailUrl: null, imageGenerationStatus: 'queued',
    isDeleted: false, wearCount: 0, lastWornAt: null, createdAt: '', updatedAt: ''
  };

  afterEach(async () => {
    await Preferences.remove({ key: 'wardrobe-ai-gemini-consent' });
  });

  async function generate(): Promise<void> {
    await Preferences.set({ key: 'wardrobe-ai-gemini-consent', value: 'accepted' });
    api.getItems.and.resolveTo([item('Top', 'tops'), item('Extra', 'tops')]);
    api.searchOutfits.and.resolveTo([suggestion]);
    api.saveOutfit.and.resolveTo(saved);
    api.markWorn.and.resolveTo();
    await page.ionViewWillEnter();
    page.query = 'Everyday';
    await page.search();
  }

  it('keeps previewless suggestions and reuses the saved outfit when wearing it', async () => {
    await generate();
    expect(page.resultCards.length).toBe(1);
    await page.save(suggestion);
    await page.wearGeneratedOutfit(page.resultCards[0]);
    await page.wearGeneratedOutfit(page.resultCards[0]);
    expect(api.saveOutfit).toHaveBeenCalledTimes(1);
    expect(api.markWorn).toHaveBeenCalledOnceWith(saved.id);
    expect(page.resultCards[0].isWornToday).toBeTrue();
  });

  it('retries failed wear logging without creating another saved outfit', async () => {
    await generate();
    api.markWorn.and.rejectWith(new Error('Connection interrupted'));
    await page.wearGeneratedOutfit(page.resultCards[0]);
    expect(page.resultCards[0].isWornToday).toBeFalse();
    api.markWorn.and.resolveTo();
    await page.wearGeneratedOutfit(page.resultCards[0]);
    expect(api.saveOutfit).toHaveBeenCalledTimes(1);
    expect(api.markWorn).toHaveBeenCalledTimes(2);
    expect(page.resultCards[0].isWornToday).toBeTrue();
  });

  it('prevents duplicate save and wear requests while saving', async () => {
    await generate();
    let finish!: (outfit: OutfitDto) => void;
    api.saveOutfit.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const saving = page.save(suggestion);
    await page.save(suggestion);
    await page.wearGeneratedOutfit(page.resultCards[0]);
    expect(api.saveOutfit).toHaveBeenCalledTimes(1);
    expect(api.markWorn).not.toHaveBeenCalled();
    finish(saved);
    await saving;
  });

  it('keeps earlier suggestions and their prompt when the next generation fails', async () => {
    await generate();
    page.query = 'Formal dinner';
    api.searchOutfits.and.rejectWith(new Error('Generation unavailable'));
    await page.search();
    expect(page.results).toEqual([suggestion]);
    expect(page.message).toContain('Generation unavailable');
    await page.save(suggestion);
    expect(api.saveOutfit.calls.mostRecent().args[1]).toContain('Everyday');
    expect(api.saveOutfit.calls.mostRecent().args[1]).not.toContain('Formal dinner');
  });

  it('locks generation before consent resolves', async () => {
    await Preferences.remove({ key: 'wardrobe-ai-gemini-consent' });
    api.getItems.and.resolveTo([item('Top', 'tops')]);
    await page.ionViewWillEnter();
    let close!: (result: { role: string }) => void;
    const create = spyOn(TestBed.inject(AlertController), 'create').and.resolveTo({
      present: async () => {}, onDidDismiss: () => new Promise(resolve => { close = resolve; })
    } as HTMLIonAlertElement);
    const searching = page.search();
    await new Promise(resolve => setTimeout(resolve, 0));
    await page.search();
    expect(create).toHaveBeenCalledTimes(1);
    close({ role: 'cancel' });
    await searching;
    expect(api.searchOutfits).not.toHaveBeenCalled();
    expect(page.isBuildingOutfits).toBeFalse();
  });

  it('preserves new manual selections while a save completes and ignores duplicate saves', async () => {
    await generate();
    spyOn(TestBed.inject(ToastController), 'create').and.resolveTo({ present: async () => {} } as HTMLIonToastElement);
    page.toggleManualItem('Top');
    page.manualName = 'First look';
    let finish!: (outfit: OutfitDto) => void;
    api.saveOutfit.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const saving = page.saveManual();
    await page.saveManual();
    page.toggleManualItem('Extra');
    page.manualName = 'Next look';
    finish(saved);
    await saving;
    expect(api.saveOutfit).toHaveBeenCalledTimes(1);
    expect(api.saveOutfit.calls.mostRecent().args[3]).toEqual(['Top']);
    expect(page.manualItemIds).toEqual(['Extra']);
    expect(page.manualName).toBe('Next look');
    expect(page.message).toContain('preview');
  });

  beforeEach(() => {
    api = jasmine.createSpyObj('WardrobeApiService', ['getLookups', 'getItems', 'searchOutfits', 'saveOutfit', 'markWorn']);
    api.getLookups.and.resolveTo(lookups);
    api.getItems.and.resolveTo([]);
    TestBed.configureTestingModule({
      declarations: [BuilderPage, LazyImageDirective],
      imports: [CommonModule, FormsModule, IonicModule.forRoot(), RouterTestingModule],
      providers: [BuilderPage, { provide: WardrobeApiService, useValue: api }]
    });
    page = TestBed.inject(BuilderPage);
  });

  it('does not ask for AI consent or send a generation request with an empty wardrobe', async () => {
    await page.ionViewWillEnter();
    const consent = spyOn(TestBed.inject(AlertController), 'create');
    await page.search();
    expect(page.canGenerate).toBeFalse();
    expect(consent).not.toHaveBeenCalled();
    expect(api.searchOutfits).not.toHaveBeenCalled();
  });

  it('explains missing pieces without preventing a partial manual look', async () => {
    api.getItems.and.resolveTo([item('Jumper', 'knitwear')]);
    await page.ionViewWillEnter();
    expect(page.wardrobeHint).toContain('bottoms or a dress');
    expect(page.wardrobeHint).toContain('shoes');
    page.toggleManualItem('Jumper');
    expect(page.manualCanSave).toBeTrue();
    expect(page.manualHint).toContain('Partial look');
  });

  it('recognises complete top, dress and one-piece combinations, including the footwear alias', async () => {
    for (const categories of [['tops', 'bottoms', 'footwear'], ['dresses', 'footwear'], ['one_pieces', 'shoes']]) {
      api.getItems.and.resolveTo(categories.map((category) => item(category, category)));
      await page.ionViewWillEnter();
      expect(page.wardrobeHint).toBe('');
    }
  });

  it('suggests shoes for a dress-only wardrobe', async () => {
    api.getItems.and.resolveTo([item('Dress', 'dresses')]);
    await page.ionViewWillEnter();
    expect(page.wardrobeHint).toContain('add shoes');
    expect(page.wardrobeHint).not.toContain('add a top');
  });

  it('renders the add-clothes action in both modes and hides unusable AI controls', async () => {
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(BuilderPage);
    await fixture.componentInstance.ionViewWillEnter();
    for (const mode of ['generate', 'manual'] as const) {
      fixture.componentInstance.setBuilderMode(mode);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.ios-empty-state').textContent).toContain('Add Clothes');
      expect(fixture.nativeElement.querySelector('.ai-generate-btn')).toBeNull();
    }
    fixture.destroy();
  });

  it('offers native keyboard-accessible prompt examples that populate the brief', async () => {
    await TestBed.compileComponents();
    api.getItems.and.resolveTo([item('Top', 'tops')]);
    const fixture = TestBed.createComponent(BuilderPage);
    await fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const example: HTMLButtonElement = fixture.nativeElement.querySelector('.prompt-quick-tags button');
    expect(example.type).toBe('button');
    example.click();
    expect(fixture.componentInstance.query).toBe('Warm layers, tailored outerwear');
    fixture.destroy();
  });
});
