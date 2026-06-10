export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-5 py-20 sm:px-6 md:px-10">
      <div className="flex gap-1.5">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" />
      </div>
    </div>
  );
}
