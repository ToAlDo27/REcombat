import releases from "./releases.json"

export function ReleaseNotes() {
  return (
    <details className="settings release-notes">
      <summary>
        Что нового <span>Версия {releases[0].version}</span>
      </summary>
      {releases.map(release => (
        <div key={release.version}>
          <p>
            {release.version} · {release.date}
          </p>
          <ul>
            {release.changes.map(change => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  )
}
