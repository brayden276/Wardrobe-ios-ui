import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { AlertController, IonicModule } from '@ionic/angular';
import { LazyImageDirective } from '../../lazy-image.directive';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { WardrobeItemDto, WardrobeLookupsDto } from '../../models';
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

  beforeEach(() => {
    api = jasmine.createSpyObj('WardrobeApiService', ['getLookups', 'getItems', 'searchOutfits']);
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
