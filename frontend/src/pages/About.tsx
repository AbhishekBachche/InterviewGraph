import { PageHeader } from "../components/PagePrimitives";
import {
  ABOUT_AUDIENCE,
  ABOUT_CAPABILITIES,
  ABOUT_COMPANY,
  ABOUT_INTRO,
} from "../content/about";
import { Card, CardContent, CardHeader, CardTitle, PageStack } from "../components/ui";

export default function About() {
  return (
    <>
      <PageHeader
        eyebrow="Dataeaze · Hireeaze AIOS"
        title="About Hireeaze AIOS"
        description={ABOUT_INTRO}
      />

      <PageStack>
        <Card className="he-about-card he-about-card--company">
          <CardHeader>
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="he-about-text">{ABOUT_COMPANY.productNote}</p>
            <p className="he-about-text u-mb-0">
              Built and operated by{" "}
              <a className="he-about-link" href={ABOUT_COMPANY.operatorUrl} target="_blank" rel="noreferrer">
                {ABOUT_COMPANY.operator}
              </a>
              —{ABOUT_COMPANY.tagline}. Visit{" "}
              <a className="he-about-link" href={ABOUT_COMPANY.operatorUrl} target="_blank" rel="noreferrer">
                dataeaze.io
              </a>{" "}
              or see{" "}
              <a className="he-about-link" href={ABOUT_COMPANY.acceleratorUrl} target="_blank" rel="noreferrer">
                Solution Accelerators
              </a>
              .
            </p>
          </CardContent>
        </Card>

        <Card className="he-about-card he-about-card--audience">
          <div className="he-about-split">
            <div className="he-about-split__copy">
              <CardHeader>
                <CardTitle>Who uses this</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="he-about-lead u-mb-0">{ABOUT_AUDIENCE.lead}</p>
              </CardContent>
            </div>
            <div className="he-about-team" aria-label="Team areas">
              {ABOUT_AUDIENCE.teams.map((team) => (
                <article
                  key={team.initials}
                  className={`he-about-team__card he-about-team__card--${team.accent}`}
                >
                  <div className="he-about-team__initials" aria-hidden>
                    {team.initials}
                  </div>
                  <h4 className="he-about-team__name">{team.name}</h4>
                  <p className="he-about-team__role">{team.role}</p>
                </article>
              ))}
            </div>
          </div>
        </Card>

        <Card className="he-about-card he-about-card--capabilities">
          <CardHeader>
            <CardTitle>What it does for us</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="he-about-capabilities">
              {ABOUT_CAPABILITIES.map((item) => (
                <li key={item.title} className="he-about-capabilities__item">
                  <span className="he-about-capabilities__title">{item.title}</span>
                  <span className="he-about-capabilities__detail">{item.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </PageStack>
    </>
  );
}
