import { Link } from "wouter";
import { useStore } from "@/hooks/use-store";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, CheckCircle2, RotateCcw } from "lucide-react";

export default function Home() {
  const { state } = useStore();

  return (
    <div className="min-h-[100dvh] w-full bg-background">
      <div className="max-w-2xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
        <header className="space-y-2 py-4">
          <h1 className="text-3xl font-serif text-primary tracking-tight">Chess Opening Trainer</h1>
          <p className="text-muted-foreground text-lg">Master the most essential openings move by move.</p>
        </header>

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
      </div>
    </div>
  );
}
