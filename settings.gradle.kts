pluginManagement {
    repositories {
        mavenLocal()
        val githubToken = providers.environmentVariable("GITHUB_TOKEN").orNull
        if (!githubToken.isNullOrBlank()) {
            maven("https://maven.pkg.github.com/TavallStudios/Tavall-Architecture-Tests") {
                credentials {
                    username = providers.environmentVariable("GITHUB_ACTOR").orElse("github").get()
                    password = githubToken
                }
            }
        }
        gradlePluginPortal()
    }
}

rootProject.name = "recovery-agent"
include(":state-authority")
