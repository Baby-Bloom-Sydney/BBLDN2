/**
 * The position flow's interstitial screen ("And lastly...", and the call path's intro — 04b rework W15): the progress
 * bar, then one centred line. Moved out of `TypeformFlow` unchanged so the intro is in exactly the same style.
 */
export function Interstitial({ text, progress, exiting }: { readonly text: string; readonly progress: number; readonly exiting: boolean }) {
  return (
    <div
      className={`relative flex flex-col h-[calc(100vh-10rem)] transition-opacity duration-200 ${
        exiting ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="-mx-4 -mt-4 lg:-mx-6 lg:-mt-6">
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-violet-600 transition-all duration-500 ease-out rounded-r-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xl sm:text-2xl font-semibold text-slate-800 text-center max-w-md px-4">
          {text}
        </p>
      </div>
    </div>
  );
}
