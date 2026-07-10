import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useStore } from "@/hooks/use-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Settings() {
  const { state, setUserName } = useStore();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="flex items-center gap-3 p-4 border-b border-border bg-card shadow-sm z-10">
        <Link href="/">
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="font-serif font-medium text-lg">Settings</h1>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto p-4 md:p-6 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="user-name">Your name</Label>
          <Input
            id="user-name"
            placeholder="Alex"
            value={state.settings.userName ?? ""}
            onChange={(e) => setUserName(e.target.value)}
            autoComplete="name"
          />
          <p className="text-sm text-muted-foreground">
            The voice coach will greet you by name when this is set.
          </p>
        </div>
      </main>
    </div>
  );
}
