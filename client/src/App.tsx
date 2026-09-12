import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WalletProvider } from "./contexts/WalletContext";
import Home from "./pages/Home";
import VerifyPage from "./pages/VerifyPage";
import AreaPage from "./pages/AreaPage";
import ContributorsPage from "./pages/ContributorsPage";
import ContributorPage from "./pages/ContributorPage";
import OpsPage from "./pages/OpsPage";

/**
 * Real routes, so a proof, an area or a contributor has a URL that can be shared. The console at
 * `/` keeps its own modes; everything else is a page inside the same shell.
 */
function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/verify"} component={VerifyPage} />
      <Route path={"/verify/:hash"} component={VerifyPage} />
      <Route path={"/area/:geohash"} component={AreaPage} />
      <Route path={"/contributors"} component={ContributorsPage} />
      <Route path={"/contributors/:address"} component={ContributorPage} />
      <Route path={"/ops"} component={OpsPage} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <WalletProvider>
            <Router />
          </WalletProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
