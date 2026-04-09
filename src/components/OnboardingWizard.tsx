interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <h2 className="text-xl font-bold">Benvenuto in Liquidò!</h2>
      <p className="text-muted-foreground text-sm">Configura il tuo profilo per iniziare.</p>
      <button onClick={onComplete} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm">
        Inizia
      </button>
    </div>
  );
}
