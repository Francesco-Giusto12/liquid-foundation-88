import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface OnboardingWizardProps {
  onComplete: () => void;
}

// ── Step types ────────────────────────────────────────────────

type Regime = "R1" | "R2" | "R3";

interface WizardData {
  fullName: string;
  accountName: string;
  accountType: string;
  accountBalance: string;
  regime: Regime;
  iva: string;
  irpef: string;
  inps: string;
}

const REGIME_OPTIONS: { key: Regime; label: string; desc: string; defaultIva: string; defaultIrpef: string; defaultInps: string }[] = [
  {
    key: "R1",
    label: "Regime Forfettario",
    desc: "Aliquota sostitutiva 15% (o 5% primi 5 anni). Esente IVA.",
    defaultIva: "0",
    defaultIrpef: "15",
    defaultInps: "26",
  },
  {
    key: "R2",
    label: "Regime Ordinario",
    desc: "IVA al 22%, IRPEF per scaglioni da 23%. Il più completo.",
    defaultIva: "22",
    defaultIrpef: "23",
    defaultInps: "26",
  },
  {
    key: "R3",
    label: "Regime Semplificato",
    desc: "Contabilità semplificata, IVA al 22%, IRPEF 25%.",
    defaultIva: "22",
    defaultIrpef: "25",
    defaultInps: "26",
  },
];

const ACCOUNT_TYPES = [
  { value: "checking", label: "Conto Corrente" },
  { value: "savings", label: "Conto Risparmio" },
  { value: "business", label: "Conto Business" },
  { value: "cash", label: "Contanti" },
  { value: "other", label: "Altro" },
];

const TOTAL_STEPS = 5;

// ── Progress bar ──────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="w-full mb-8">
      <div className="flex items-center justify-between mb-2">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div key={i} className="flex items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
              i < step
                ? "bg-primary text-primary-foreground"
                : i === step
                ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                : "bg-muted text-muted-foreground"
            }`}>
              {i < step ? "✓" : i + 1}
            </div>
            {i < TOTAL_STEPS - 1 && (
              <div className={`flex-1 h-1 mx-1 rounded transition-all duration-300 ${
                i < step ? "bg-primary" : "bg-muted"
              }`} />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>Benvenuto</span>
        <span>Profilo</span>
        <span>Conto</span>
        <span>Fiscale</span>
        <span>Fatto!</span>
      </div>
    </div>
  );
}

// ── Step 0: Welcome ───────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-4xl">💧</span>
        </div>
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Benvenuto in Liquidò!</h1>
        <p className="text-muted-foreground max-w-sm mx-auto">
          Liquidò calcola la tua <strong>liquidità reale</strong> — quello che puoi davvero spendere dopo aver accantonato IVA, IRPEF e contributi INPS.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
        <div className="flex flex-col items-center gap-1 p-3 rounded-xl bg-muted/50">
          <span className="text-xl">🏦</span>
          <span className="text-xs text-muted-foreground text-center">Collega i tuoi conti</span>
        </div>
        <div className="flex flex-col items-center gap-1 p-3 rounded-xl bg-muted/50">
          <span className="text-xl">📊</span>
          <span className="text-xs text-muted-foreground text-center">Calcolo fiscale automatico</span>
        </div>
        <div className="flex flex-col items-center gap-1 p-3 rounded-xl bg-muted/50">
          <span className="text-xl">✨</span>
          <span className="text-xs text-muted-foreground text-center">Liquidità reale sempre aggiornata</span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Ci vogliono <strong>2 minuti</strong> per configurare tutto.
      </p>
      <Button size="lg" className="w-full max-w-xs mx-auto" onClick={onNext}>
        Inizia la configurazione →
      </Button>
    </div>
  );
}

// ── Step 1: Profile ───────────────────────────────────────────

function StepProfile({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Il tuo profilo</h2>
        <p className="text-sm text-muted-foreground">Come ti chiami? Useremo il tuo nome nell'app.</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Nome e Cognome</Label>
          <Input
            placeholder="es. Mario Rossi"
            value={data.fullName}
            onChange={(e) => onChange({ fullName: e.target.value })}
          />
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onBack} className="flex-1">← Indietro</Button>
        <Button onClick={onNext} disabled={!data.fullName.trim()} className="flex-1">
          Continua →
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: Account ───────────────────────────────────────────

function StepAccount({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Il tuo primo conto</h2>
        <p className="text-sm text-muted-foreground">
          Aggiungi il conto principale. Il <strong>saldo iniziale</strong> è fondamentale per calcolare correttamente la liquidità reale.
        </p>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Nome del conto</Label>
          <Input
            placeholder="es. Conto Corrente BancaSella"
            value={data.accountName}
            onChange={(e) => onChange({ accountName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Tipo di conto</Label>
          <Select value={data.accountType} onValueChange={(v) => onChange({ accountType: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Seleziona tipo…" />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Saldo iniziale (€)</Label>
          <Input
            type="number"
            placeholder="es. 5000"
            value={data.accountBalance}
            onChange={(e) => onChange({ accountBalance: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Inserisci il saldo attuale del conto. Puoi sempre modificarlo in seguito.
          </p>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onBack} className="flex-1">← Indietro</Button>
        <Button
          onClick={onNext}
          disabled={!data.accountName.trim() || !data.accountType}
          className="flex-1"
        >
          Continua →
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Tax regime ────────────────────────────────────────

function StepFiscale({
  data,
  onChange,
  onNext,
  onBack,
  saving,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}) {
  const selected = REGIME_OPTIONS.find((r) => r.key === data.regime);

  const handleRegimeSelect = (key: Regime) => {
    const r = REGIME_OPTIONS.find((o) => o.key === key)!;
    onChange({
      regime: key,
      iva: r.defaultIva,
      irpef: r.defaultIrpef,
      inps: r.defaultInps,
    });
  };

  const totalPct = [data.iva, data.irpef, data.inps]
    .filter(Boolean)
    .reduce((s, v) => s + Number(v), 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Regime fiscale</h2>
        <p className="text-sm text-muted-foreground">
          Scegli il tuo regime. Le aliquote vengono precompilate automaticamente — puoi modificarle.
        </p>
      </div>

      {/* Regime selector */}
      <div className="grid gap-3">
        {REGIME_OPTIONS.map((r) => (
          <div
            key={r.key}
            onClick={() => handleRegimeSelect(r.key)}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
              data.regime === r.key
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{r.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                data.regime === r.key ? "border-primary bg-primary" : "border-muted-foreground"
              }`}>
                {data.regime === r.key && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Aliquote analitiche */}
      {data.regime && (
        <div className="space-y-3 p-4 rounded-xl bg-muted/40">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Aliquote analitiche</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">🧾 IVA</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} max={100}
                  value={data.iva}
                  onChange={(e) => onChange({ iva: e.target.value })}
                  className="h-8 text-sm tabular-nums"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">📊 IRPEF</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} max={100}
                  value={data.irpef}
                  onChange={(e) => onChange({ irpef: e.target.value })}
                  className="h-8 text-sm tabular-nums"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">🛡️ INPS</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} max={100}
                  value={data.inps}
                  onChange={(e) => onChange({ inps: e.target.value })}
                  className="h-8 text-sm tabular-nums"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Totale accantonamento: <strong>{totalPct}%</strong>
          </p>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onBack} className="flex-1">← Indietro</Button>
        <Button onClick={onNext} disabled={!data.regime || saving} className="flex-1">
          {saving ? "Salvataggio…" : "Continua →"}
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Done ──────────────────────────────────────────────

function StepDone({
  data,
  onComplete,
}: {
  data: WizardData;
  onComplete: () => void;
}) {
  const regime = REGIME_OPTIONS.find((r) => r.key === data.regime);
  const totalPct = [data.iva, data.irpef, data.inps]
    .filter(Boolean)
    .reduce((s, v) => s + Number(v), 0);

  return (
    <div className="text-center space-y-6">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <span className="text-4xl">🎉</span>
        </div>
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Sei pronto, {data.fullName.split(" ")[0]}!</h2>
        <p className="text-muted-foreground text-sm">
          Liquidò è configurato. Ecco il riepilogo della tua configurazione:
        </p>
      </div>

      {/* Riepilogo */}
      <div className="text-left space-y-3 max-w-sm mx-auto">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span className="text-sm text-muted-foreground">🏦 Conto</span>
          <span className="text-sm font-medium">{data.accountName}</span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span className="text-sm text-muted-foreground">💰 Saldo iniziale</span>
          <span className="text-sm font-medium">
            {data.accountBalance ? `€ ${Number(data.accountBalance).toLocaleString("it-IT")}` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span className="text-sm text-muted-foreground">📋 Regime</span>
          <span className="text-sm font-medium">{regime?.label}</span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <span className="text-sm text-muted-foreground">🧾 IVA / IRPEF / INPS</span>
          <span className="text-sm font-medium">{data.iva}% / {data.irpef}% / {data.inps}%</span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
          <span className="text-sm font-medium">💧 Accantonamento totale</span>
          <span className="text-sm font-bold text-primary">{totalPct}%</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Puoi modificare tutto in qualsiasi momento nelle <strong>Impostazioni</strong>.
      </p>

      <Button size="lg" className="w-full max-w-xs mx-auto" onClick={onComplete}>
        Vai alla Dashboard 🚀
      </Button>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<WizardData>({
    fullName: "",
    accountName: "",
    accountType: "checking",
    accountBalance: "",
    regime: "R1",
    iva: "0",
    irpef: "15",
    inps: "26",
  });

  const update = (partial: Partial<WizardData>) =>
    setData((d) => ({ ...d, ...partial }));

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => s - 1);

  // Salva tutto su Supabase prima dell'ultimo step
  const saveAndFinish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // 1. Aggiorna nome profilo
      if (data.fullName.trim()) {
        await supabase
          .from("profiles")
          .update({ full_name: data.fullName.trim() })
          .eq("id", user.id);
      }

      // 2. Crea conto bancario
      if (data.accountName.trim()) {
        await supabase.from("accounts").insert({
          user_id: user.id,
          name: data.accountName.trim(),
          type: data.accountType,
          balance: data.accountBalance ? Number(data.accountBalance) : 0,
          is_active: true,
        });
      }

      // 3. Attiva regime fiscale
      const regimeOption = REGIME_OPTIONS.find((r) => r.key === data.regime)!;
      const today = new Date();
      const validFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const validTo = yesterday.toISOString().slice(0, 10);

      // Chiudi regime attivo precedente
      await supabase
        .from("tax_regime_history")
        .update({ valid_to: validTo })
        .eq("user_id", user.id)
        .is("valid_to", null);

      // Inserisci nuovo regime
      await supabase.from("tax_regime_history").insert({
        user_id: user.id,
        regime_key: data.regime,
        regime_label: regimeOption.label,
        aliquota: Number(data.irpef) / 100,
        valid_from: validFrom,
      });

      // 4. Salva aliquote analitiche
      await supabase.from("tax_rates").upsert({
        user_id: user.id,
        iva:   data.iva   ? Number(data.iva)   / 100 : null,
        irpef: data.irpef ? Number(data.irpef) / 100 : null,
        inps:  data.inps  ? Number(data.inps)  / 100 : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      // 5. Marca onboarding completato
      await supabase
        .from("profiles")
        .update({ onboarding_completed: true } as any)
        .eq("id", user.id);

      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["tax-rates"] });
      queryClient.invalidateQueries({ queryKey: ["tax-regime-history"] });
      queryClient.invalidateQueries({ queryKey: ["profile-onboarding"] });

      next(); // vai allo step Done
    } catch (err) {
      console.error("Onboarding save error:", err);
      toast.error("Errore nel salvataggio. Riprova.");
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="text-2xl">💧</span>
          <span className="text-xl font-bold">Liquidò</span>
        </div>

        {/* Progress */}
        <ProgressBar step={step} />

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          {step === 0 && <StepWelcome onNext={next} />}
          {step === 1 && <StepProfile data={data} onChange={update} onNext={next} onBack={back} />}
          {step === 2 && <StepAccount data={data} onChange={update} onNext={next} onBack={back} />}
          {step === 3 && (
            <StepFiscale
              data={data}
              onChange={update}
              onNext={saveAndFinish}
              onBack={back}
              saving={saving}
            />
          )}
          {step === 4 && <StepDone data={data} onComplete={onComplete} />}
        </div>
      </div>
    </div>
  );
}
