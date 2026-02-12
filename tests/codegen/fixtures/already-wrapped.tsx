import { useTranslations } from "next-intl";

export default function Hero() {
	const t = useTranslations();
	return (
		<div>
			<h1>{t("hero.welcome")}</h1>
			<p>{t("hero.getStarted")}</p>
			<button>{t("common.signUp")}</button>
			<input placeholder={t("common.searchPlaceholder")} />
		</div>
	);
}
