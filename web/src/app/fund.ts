import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, signal, viewChild } from '@angular/core';
import QRCode from 'qrcode';
import { Icon } from './icon';
import { longDate } from './format';

/**
 * One donation, as logged by hand in fund.json. The file is public, so it holds only what's fine to show:
 * a name only when the donor agreed to it, and the rupees received (Ko-fi payouts after conversion).
 */
interface Donation {
  date: string;
  amount: number;
  via?: 'upi' | 'kofi';
  name?: string;
}

/** public/data/fund.json, edited by hand: one entry in `donations` per payment received. */
interface FundConfig {
  title: string;
  pitch: string;
  /** What the bike costs. The goal adds the payment fees and income tax on top, so this much is left. */
  bikePrice: number;
  /**
   * UPI transfers are free. Ko-fi takes nothing on donations, but its payouts go through PayPal, which
   * charges a fee (plus GST in India) on what comes in. kofiSharePercent is the guess at how much of the
   * total arrives that way; the fee is charged only on that part.
   */
  fees: { kofiSharePercent: number; paypalPercent: number; gstOnFeePercent: number };
  /** Income tax on the money received, at the owner's slab rate, plus health and education cess. */
  tax: { ratePercent: number; cessPercent: number };
  /** The goal is rounded up to a multiple of this, in rupees. */
  roundTo: number;
  donations: Donation[];
  upi: { id: string; name: string };
  /** The Ko-fi page, e.g. https://ko-fi.com/yourname. */
  kofi: string;
}

const PRESETS = [100, 500, 1000, 5000];
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const UPI_ID = /^[\w.-]{2,256}@[a-zA-Z][\w.-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RECENT = 5;

/** Entries with a real date and a positive amount; a typo in one line shouldn't break the total. */
function validDonations(f: FundConfig | null): Donation[] {
  return (Array.isArray(f?.donations) ? f.donations : []).filter(
    (d) => d && DAY.test(String(d.date)) && Number.isFinite(d.amount) && d.amount > 0,
  );
}

interface Goal {
  total: number;
  bike: number;
  fees: number;
  feeRate: number;
  tax: number;
  taxRate: number;
  /** What rounding the goal up adds beyond the bike, fees and tax. */
  buffer: number;
}

/**
 * The amount to raise so the bike price is left after fees and tax. Both are charged on what donors pay,
 * so the price is grossed up: total × (1 − fee rate − tax rate) ≥ bike price. The fee rate is PayPal's
 * cut (plus GST) on the share expected through Ko-fi; the UPI share costs nothing.
 */
function goalFor(f: FundConfig): Goal {
  const pct = (n: number | undefined) => Math.max(n ?? 0, 0) / 100;
  const feeRate = pct(f.fees?.kofiSharePercent) * pct(f.fees?.paypalPercent) * (1 + pct(f.fees?.gstOnFeePercent));
  const taxRate = pct(f.tax?.ratePercent) * (1 + pct(f.tax?.cessPercent));
  const keep = Math.max(1 - feeRate - taxRate, 0.05);
  const step = Math.max(f.roundTo || 1, 1);
  const total = Math.ceil(f.bikePrice / keep / step) * step;
  const fees = Math.round(total * feeRate);
  const tax = Math.round(total * taxRate);
  return { total, bike: f.bikePrice, fees, feeRate, tax, taxRate, buffer: Math.max(total - f.bikePrice - fees - tax, 0) };
}

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
        <span class="fund-pct num">{{ pctLabel() }}</span>
        <span class="sr-only">{{ f.title }}: {{ inr(raised()) }} of {{ inr(goal().total) }} raised</span>
      </button>

      <dialog #dlg class="fund-dialog" aria-labelledby="fund-title" (click)="onBackdrop($event)" (close)="copied.set(false)">
        <div class="fund-inner">
          <header class="fund-head">
            <h2 id="fund-title"><app-icon name="motorbike" [size]="22" />{{ f.title }}</h2>
            <button type="button" class="icon-btn" (click)="close()" aria-label="Close"><app-icon name="close" [size]="18" /></button>
          </header>
          <p class="note">{{ f.pitch }}</p>

          <div class="fund-progress">
            <div class="fund-figures">
              <span class="fund-raised num">{{ inr(raised()) }}</span>
              <span class="note num">raised of {{ inr(goal().total) }}</span>
            </div>
            <div class="track" role="progressbar" aria-label="Amount raised" [attr.aria-valuenow]="raised()" aria-valuemin="0" [attr.aria-valuemax]="goal().total" [attr.aria-valuetext]="inr(raised()) + ' of ' + inr(goal().total)">
              <div class="fill" [style.width.%]="share() * 100"></div>
            </div>
            <div class="fund-sub note num">
              <span>{{ pctLabel() }} · {{ inr(left()) }} to go</span>
              <span class="with-icon"><app-icon name="heart" [size]="13" />{{ supporters() }} {{ supporters() === 1 ? 'supporter' : 'supporters' }}</span>
            </div>
            <p class="note fund-updated">
              @if (lastDonation(); as d) { Logged by hand · latest donation {{ longDate(d) }} } @else { No donations logged yet }
            </p>
          </div>

          @if (recent().length) {
            <section class="fund-recent" aria-labelledby="fund-recent-h">
              <h3 id="fund-recent-h"><app-icon name="heart" [size]="15" />Recent supporters</h3>
              <ul>
                @for (d of recent(); track $index) {
                  <li>
                    <span class="fund-who">{{ d.name?.trim() || 'Anonymous' }}</span>
                    <span class="note num">{{ inr(d.amount) }} · {{ d.via === 'kofi' ? 'Ko-fi' : 'UPI' }} · {{ longDate(d.date) }}</span>
                  </li>
                }
              </ul>
            </section>
          }

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
                  <p class="fund-verify with-icon"><app-icon name="check" [size]="14" />Before you pay, check your app shows the payee as <b>{{ f.upi.name }}</b>. If it shows any other name, don't pay.</p>
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
  protected readonly longDate = longDate;
  protected readonly fund = signal<FundConfig | null>(null);
  protected readonly amount = signal(500);
  protected readonly copied = signal(false);
  protected readonly qr = signal('');
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly goal = computed<Goal>(() => {
    const f = this.fund();
    return f ? goalFor(f) : { total: 0, bike: 0, fees: 0, feeRate: 0, tax: 0, taxRate: 0, buffer: 0 };
  });
  private readonly donations = computed(() => validDonations(this.fund()));
  protected readonly raised = computed(() => this.donations().reduce((sum, d) => sum + d.amount, 0));
  /** Named donors count once however often they give; each anonymous gift counts as its own supporter. */
  protected readonly supporters = computed(() => {
    const named = new Set<string>();
    let anonymous = 0;
    for (const d of this.donations()) {
      const name = d.name?.trim().toLowerCase();
      if (name) named.add(name);
      else anonymous++;
    }
    return named.size + anonymous;
  });
  protected readonly lastDonation = computed(() =>
    this.donations().reduce<string | null>((last, d) => (!last || d.date > last ? d.date : last), null),
  );
  protected readonly recent = computed(() =>
    [...this.donations()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT),
  );
  protected readonly share = computed(() => {
    const total = this.goal().total;
    return total > 0 ? Math.min(Math.max(this.raised() / total, 0), 1) : 0;
  });
  protected readonly left = computed(() => Math.max(this.goal().total - this.raised(), 0));
  protected readonly pctLabel = computed(() => {
    const p = this.share() * 100;
    return `${p > 0 && p < 1 ? p.toFixed(1) : Math.floor(p)}%`;
  });

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
