type PairingSuccessBannerProps = {
  venueName: string;
};

export function PairingSuccessBanner({ venueName }: PairingSuccessBannerProps) {
  return (
    <div
      className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <p className="font-medium text-primary text-sm">Connected to {venueName}</p>
      <p className="mt-0.5 text-primary/80 text-xs">Choose your kitchen printer below.</p>
    </div>
  );
}
