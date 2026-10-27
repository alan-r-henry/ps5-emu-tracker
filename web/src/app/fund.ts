import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, signal, viewChild } from '@angular/core';
import QRCode from 'qrcode';
import { Icon } from './icon';

/** public/data/fund.json, edited by hand. */
interface FundConfig {
  title: string;
  pitch: string;
  upi: { id: string; name: string };
  /** The Ko-fi page, e.g. https://ko-fi.com/yourname. */
  kofi: string;
}

const PRESETS = [100, 500, 1000, 5000];
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const UPI_ID = /^[\w.-]{2,256}@[a-zA-Z][\w.-]{1,64}$/;

/**
 * The bike button in the masthead and its dialog. Payments go straight from the donor's UPI app or
 * Ko-fi to the owner's account; this page only builds the UPI link and links to the Ko-fi page.
 */
@Component({
  selector: 'app-fund',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (fund(); as f) {
      <button type="button" class="fund-btn" (click)="open()" aria-haspopup="dialog" [title]="f.title">
        <app-icon name="motorbike" [size]="22" />
        <span class="sr-only">{{ f.title }}</span>
      </button>

      <dialog #dlg class="fund-dialog" aria-labelledby="fund-title" (click)="onBackdrop($event)" (close)="copied.set(false)">
        <div class="fund-inner">
          <header class="fund-head">
            <h2 id="fund-title"><app-icon name="motorbike" [size]="22" />{{ f.title }}</h2>
            <button type="button" class="icon-btn" (click)="close()" aria-label="Close"><app-icon name="close" [size]="18" /></button>
          </header>
          <p class="note">{{ f.pitch }}</p>

          @if (upiId()) {
            <fieldset class="fund-amounts">
              <legend>Amount</legend>
              @for (a of presets; track a) {
                <button type="button" class="chip" [attr.aria-pressed]="amount() === a" (click)="amount.set(a)">{{ inr(a) }}</button>
              }
              <label class="chip custom">₹
                <input type="number" min="1" step="1" inputmode="numeric" placeholder="Other" aria-label="Other amount in rupees" [value]="presets.includes(amount()) ? '' : amount()" (input)="onCustom($event)">
              </label>
            </fieldset>
          }

          @if (upiId(); as id) {
            <section class="fund-upi" aria-label="Pay with UPI">
              <div class="qr">
                @if (qr()) { <img [src]="qr()" width="180" height="180" [alt]="'UPI QR code to pay ' + inr(amount())"> }
              </div>
              <div class="fund-upi-text">
                <h3><app-icon name="phone" [size]="16" />UPI</h3>
                <p class="note">Scan with GPay, PhonePe, Paytm or any UPI app. The amount is filled in; you can change it in the app.</p>
                @if (f.upi.name) {
                  <p class="fund-verify with-icon"><app-icon name="check" [size]="14" /><span>Before you pay, check your app shows the payee as <b>{{ f.upi.name }}</b>. If it shows any other name, don't pay.</span></p>
                }
                <button type="button" class="btn with-icon" (click)="copyId(id)">
                  <app-icon [name]="copied() ? 'check' : 'copy'" [size]="14" />{{ copied() ? 'Copied' : id }}
                </button>
              </div>
            </section>
          }

          @if (kofi(); as url) {
            <section class="fund-card" aria-label="Support on Ko-fi">
              <h3><app-icon name="coffee" [size]="16" />Outside India? Use Ko-fi</h3>
              <p class="note">Pay by card or PayPal in your own currency. Opens Ko-fi in a new tab.</p>
              <a class="btn with-icon" [href]="url" target="_blank" rel="noopener"><app-icon name="external" [size]="14" />Support on Ko-fi</a>
            </section>
          }

          @if (!upiId() && !kofi()) {
            <p class="problems">Payment details aren't set up yet.</p>
          }

          <p class="note fund-safe">Payments go straight to the owner's UPI account or Ko-fi page. This site never sees card or bank details.</p>
        </div>
      </dialog>
    }
  `,
})
export class FundButton {
  protected readonly presets = PRESETS;
  protected readonly fund = signal<FundConfig | null>(null);
  protected readonly amount = signal(500);
  protected readonly copied = signal(false);
  protected readonly qr = signal('');
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  /** Only well-formed values from fund.json reach a link: a UPI address and an https Ko-fi page. */
  protected readonly upiId = computed(() => {
    const id = this.fund()?.upi?.id?.trim() ?? '';
    return UPI_ID.test(id) ? id : '';
  });
  protected readonly kofi = computed(() => {
    const url = this.fund()?.kofi?.trim() ?? '';
    return /^https:\/\/ko-fi\.com\/\w+\/?$/.test(url) ? url : '';
  });

  /** The standard UPI deep link (NPCI "upi://pay") the QR code carries; apps prefill the payee, amount and note. */
  protected readonly upiLink = computed(() => {
    const id = this.upiId();
    if (!id) return '';
    const name = this.fund()?.upi?.name?.trim() || id;
    const q = [
      ['pn', name],
      ['am', this.amount().toFixed(2)],
      ['cu', 'INR'],
      ['tn', 'Dream bike fund'],
    ];
    // The payee ID stays as written: some UPI apps don't decode "%40", and UPI_ID allows nothing that needs escaping.
    return `upi://pay?pa=${id}&` + q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  });

  constructor() {
    void fetch('data/fund.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((f: FundConfig | null) => this.fund.set(f))
      .catch(() => this.fund.set(null));

    // Black on white, the contrast scanners expect, in both themes.
    effect(() => {
      const link = this.upiLink();
      if (!link) return;
      QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
        .then((url) => this.qr.set(url))
        .catch(() => this.qr.set(''));
    });
  }

  protected inr(n: number): string {
    return INR.format(n);
  }

  protected open(): void {
    this.dlg()?.nativeElement.showModal();
  }

  protected close(): void {
    this.dlg()?.nativeElement.close();
  }

  /** A click on the dialog element itself (not its contents) is a click on the backdrop. */
  protected onBackdrop(ev: MouseEvent): void {
    if (ev.target === this.dlg()?.nativeElement) this.close();
  }

  protected onCustom(ev: Event): void {
    const v = Math.round(Number((ev.target as HTMLInputElement).value));
    if (Number.isFinite(v) && v >= 1) this.amount.set(Math.min(v, 100000));
  }

  protected copyId(id: string): void {
    void navigator.clipboard?.writeText(id).then(() => this.copied.set(true));
  }
}
