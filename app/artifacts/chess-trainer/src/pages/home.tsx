import { Link } from "wouter";
import { useStore } from "@/hooks/use-store";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, CheckCircle2, RotateCcw, Heart, Trash2, Sparkles, Settings, Github } from "lucide-react";
import { Logo } from "@/components/logo";

export default function Home() {
  const { state, resetAllLessons } = useStore();

  const handleResetAll = () => {
    const ok = window.confirm(
      "Reset progress on ALL lessons? Your moves, chat history, and completion status will be wiped.",
    );
    if (ok) resetAllLessons();
  };

  const anyStarted = Object.values(state.lessons).some((l) => l.status !== "not_started");

  return (
    <div className="min-h-[100dvh] w-full bg-background">
      <div className="max-w-2xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <header className="flex items-start justify-between py-4 gap-4">
          <Logo showTagline size="lg" markTile />
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground" title="Settings">
              <Settings className="w-5 h-5" />
            </Button>
          </Link>
        </header>

        {/* Open source note */}
        <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground flex items-start gap-3">
          <Github className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <p className="leading-relaxed">
            ChessMaster is open source — anyone can run their own copy. Fork it, deploy it, and make it yours on{" "}
            <a
              href="https://github.com/alirizasaral/ChessMaster"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
              data-testid="link-github"
            >
              GitHub
            </a>
            .
          </p>
        </div>

        {/* Donation note */}
        <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground flex items-start gap-3">
          <Heart className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <p className="leading-relaxed">
            This is a hobby project. If you enjoy it, you can help cover hosting and API costs at{" "}
            <a
              href="https://buymeacoffee.com/alirizasara"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
              data-testid="link-donate"
            >
              buymeacoffee.com/alirizasara
            </a>
            . Thank you!
          </p>
        </div>

        {/* Free play with the coach */}
        <Link href="/free-play" className="block group no-default-hover-elevate">
          <Card className="hover-elevate transition-all duration-300 border-primary/30 bg-primary/5 hover:border-primary/60">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <CardTitle className="text-xl font-medium font-serif text-card-foreground flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Play freely with the coach
                </CardTitle>
              </div>
              <CardDescription className="text-sm text-muted-foreground leading-relaxed pt-1">
                No lesson script — just a casual game against the coach. She'll react to every move with a quick, in-character take.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center text-sm font-medium text-primary group-hover:translate-x-1 transition-transform">
                <Play className="w-4 h-4 mr-2" /> Start a free game
              </div>
            </CardContent>
          </Card>
        </Link>

        <div className="pt-2 pb-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Opening lessons
          </h2>
        </div>

        <main className="grid gap-4">
          {Object.values(state.lessons).map((lesson) => (
            <Link key={lesson.id} href={`/lesson/${lesson.id}`} className="block group no-default-hover-elevate">
              <Card className="hover-elevate transition-all duration-300 border-border hover:border-primary/50 bg-card">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-xl font-medium font-serif text-card-foreground">
                      {lesson.name}
                    </CardTitle>
                    {lesson.status === "finished" && (
                      <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Finished
                      </Badge>
                    )}
                    {lesson.status === "started" && (
                      <Badge variant="outline" className="text-muted-foreground border-border">
                        In Progress
                      </Badge>
                    )}
                    {lesson.status === "not_started" && (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">
                        Not Started
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-sm text-muted-foreground leading-relaxed pt-1">
                    {lesson.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center text-sm font-medium text-primary group-hover:translate-x-1 transition-transform">
                    {lesson.status === "not_started" ? (
                      <>
                        <Play className="w-4 h-4 mr-2" /> Start Lesson
                      </>
                    ) : lesson.status === "started" ? (
                      <>
                        <Play className="w-4 h-4 mr-2" /> Continue
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-4 h-4 mr-2" /> Review
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </main>

        {anyStarted && (
          <div className="flex justify-center pt-2 pb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetAll}
              className="text-muted-foreground hover:text-destructive"
              data-testid="button-reset-all"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Reset all progress
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
