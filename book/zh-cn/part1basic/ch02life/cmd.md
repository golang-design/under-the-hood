---
weight: 1201
title: "2.1 从 `go` 命令谈起"
---

# 2.1 从 `go` 命令谈起



Go 程序的生命周期要从执行 `go` 命令开始谈起。

## 2.1.1 Go Run 与 Go Build 命令

- 设置具体的指令
- go run   --> run.CmdRun
- go build --> work.CmdBuild

```go
// src/cmd/go/main.go
func init() {
	base.Go.Commands = []*base.Command{
		work.CmdBuild,
		run.CmdRun,
		...
	}
}
func main() {
	flag.Usage = base.Usage
	flag.Parse()
	log.SetFlags(0)

	args := flag.Args()
	if len(args) < 1 {
		base.Usage()
	}

	...

	// 从左至右依次解析 go 指令
BigCmdLoop:
	for bigCmd := base.Go; ; {
		for _, cmd := range bigCmd.Commands {
			// 匹配具体的指令，args[0] 是 go 指令后紧跟的第一个参数，如 run、build。
			if cmd.Name() != args[0] {
				continue
			}
			...
			// 根据指令和参数执行编译或运行
			cmd.Run(cmd, args)
			base.Exit()
			return
		}
		...
	}
}
```

TODO:

```go
// src/cmd/go/internal/work/build.go
var CmdBuild = &base.Command{
	UsageLine: "go build [-o output] [-i] [build flags] [packages]",
	Short:     "compile packages and dependencies",
	Long: `...`,
}
func init() {
	CmdBuild.Run = runBuild
	// -o 参数解析
	CmdBuild.Flag.StringVar(&cfg.BuildO, "o", "", "output file or directory")
	...

	switch build.Default.Compiler {
	case "gc", "gccgo":
		buildCompiler{}.Set(build.Default.Compiler) // gc
	}
}
type buildCompiler struct{}

func (c buildCompiler) Set(value string) error {
	switch value {
	case "gc":
		BuildToolchain = gcToolchain{}
	...
	}
	...

	return nil
}
func runBuild(cmd *base.Command, args []string) {
	BuildInit()
	var b Builder
	b.Init()

	pkgs := load.PackagesForBuild(args)
	...

	depMode := ModeBuild
	if cfg.BuildI {
		depMode = ModeInstall
	}
	...

	a := &Action{Mode: "go build"}
	for _, p := range pkgs {
		a.Deps = append(a.Deps, b.AutoAction(ModeBuild, depMode, p))
	}
	...
	b.Do(a)
}
```

```go
type Builder struct {
	WorkDir     string               // the temporary work directory (ends in filepath.Separator)
	actionCache map[cacheKey]*Action // a cache of already-constructed actions
	mkdirCache  map[string]bool      // a cache of created directories
	flagCache   map[[2]string]bool   // a cache of supported compiler flags
	Print       func(args ...interface{}) (int, error)

	IsCmdList           bool // running as part of go list; set p.Stale and additional fields below
	NeedError           bool // list needs p.Error
	NeedExport          bool // list needs p.Export
	NeedCompiledGoFiles bool // list needs p.CompiledGoFIles

	objdirSeq int // counter for NewObjdir
	pkgSeq    int

	output    sync.Mutex
	scriptDir string // current directory in printed script

	exec      sync.Mutex
	readySema chan bool
	ready     actionQueue

	id           sync.Mutex
	toolIDCache  map[string]string // tool name -> tool ID
	buildIDCache map[string]string // file name -> build ID
}
// AutoAction returns the "right" action for go build or go install of p.
func (b *Builder) AutoAction(mode, depMode BuildMode, p *load.Package) *Action {
	if p.Name == "main" {
		return b.LinkAction(mode, depMode, p)
	}
	return b.CompileAction(mode, depMode, p)
}
```


TODO: 未完成，当前内容来源于 `src/cmd/compile/README.md`


## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).