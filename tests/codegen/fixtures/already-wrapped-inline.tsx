import { T, useT } from "@/components/t";

export default function Hero() {
  const t = useT();
  return (
    <div>
      <h1><T id="hero.welcome">Welcome to our platform</T></h1>
      <p><T id="hero.getStarted">Get started with your journey today</T></p>
      <button><T id="common.signUp">Sign up now</T></button>
      <input placeholder={t("Search...", "common.searchPlaceholder")} />
    </div>
  );
}
