---
weight: 1404
title: "4.4 错误语义"
---

# 4.4 错误语义

我们其实已经在前面的讨论中详细讨论过了错误值检查与错误上下文的增强手段，
处理方式啰嗦而冗长，减少这种代码出现的密集程度真的是一个实际的问题吗？换句话说：
社区里怨声载道的冗长的错误处理语义，真的有必要进行改进吗？

### 4.4.1 check/handle 关键字

Go 团队在重新考虑错误处理的时候提出过两种不同的方案，
由 Russ Cox 提出的第一种方案就是引入新的关键字 `check`/`handle` 进行组合。

我们来看这样一个复制文件的例子。复制文件操作涉及到源文件的打开、目标文件的创建、
内容的复制、源文件和目标文件的关闭。这之间任何一个环节出错，都需要错误进行处理：

```go
func CopyFile(src, dst string) error {
	r, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}
	defer r.Close()

	w, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}

	if _, err := io.Copy(w, r); err != nil {
		w.Close()
		os.Remove(dst)
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}

	if err := w.Close(); err != nil {
		os.Remove(dst)
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}
}
```

在使用 `check`/`handle` 组合后，我们可以将前面的代码进行化简，较少 `if err != nil`
的出现频率，并统一在 `handle` 代码块中对错误进行处理：

```go
func CopyFile(src, dst string) error {
	handle err {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}

	r := check os.Open(src)
	defer r.Close()

	w := check os.Create(dst)
	handle err {
		w.Close()
		os.Remove(dst) // (only if a check fails)
	}

	check io.Copy(w, r)
	check w.Close()  // 此处发生 err 调用上方的 handle 块时还会再额外调用一次 w.Close()
	return nil
}
```

这种使用 `check` 和 `handle` 的方式会当 `err` 发生时，直接进入 `check` 关键字上方
最近的一个 `handle err` 块进行错误处理。在官方的这个例子中其实就已经发生了语言上模棱两可的地方，
当函数最下方的 `w.Close` 产生调用时，
上方与其最近的一个 `handle err` 还会再一次调用 `w.Close`，这其实是多余的。

此外，这种方式看似对代码进行了简化，但仔细一看这种方式与 `defer` 函数进行错误处理之间，
除了减少了 `if err != nil { return err }` 出现的频率，并没有带来任何本质区别。
例如，我们完全可以使用 `defer` 来实现 `handle` 的功能：

```go
func CopyFile(src, dst string) (err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("copy %s %s: %v", src, dst, err)
		}
	}()

	r, err := os.Open(src)
	if err != nil { return }
	defer r.Close()

	w, err := os.Create(dst)
	if err != nil { return }

	defer func() {
		if err != nil {
			w.Close()
			os.Remove(dst)
		}
	}()
	_, err = io.Copy(w, r)
	if err != nil { return }

	err = w.Close()
	if err != nil { return }
}
```

在仔细衡量后不难看出，`check`/`handle` 关键字的设计中，`handle` 仅仅只是对现有的语义的一个化简。
具体来说，`handle` 关键字等价于 `defer`：

```go
handle err { ... }
=>
defer func() {
	if err != nil {
		err = ...
	}
}()
```

而 `check` 关键字则等价于：

```go
check F()
=>
err = F()
if err != nil {
	return
}
```

那么能不能仅实现一个 `check` 关键字呢？

### 4.4.2 内建函数 `try()`

紧随 `check/handle` 的提案，Robert Griesemer 提出了使用内建函数 `try()`
配合延迟语句来替代 `check`，它能够接收最后一个返回值为 `error` 的函数，
并将除 `error` 之外的返回值进行返回，即：

```go
x1, x2, ..., xn = try(F())
=>
t1, ..., tn, te := F()
if te != nil {
		err = te
		return
}
x1, ..., xn = t1, ..., tn
```

有了 `try()` 函数后，可以将复制文件例子中的代码化简为：

```go
func CopyFile(src, dst string) (err error) {
		defer func() {
				if err != nil {
					err = fmt.Errorf("copy %s %s: %v", src, dst, err)
				}
		}()

		r := try(os.Open(src))
		defer r.Close()

		w := try(os.Create(dst))
		defer func() {
				w.Close()
				if err != nil {
					os.Remove(dst) // 仅当 try 失败时才调用
				}
		}()

		try(io.Copy(w, r))
		try(w.Close())
		return nil
}
```

可见，这种做法与 `check/handle` 的关键字组合本质上也没有代码更多思想上的变化，
尤其是 `try()` 内建函数仅仅在在形式上对 `if err != nil { ... }` 起到了化简的作用。

但这一错误处理语义并没有在最后被纳入语言规范。
这一设计被拒绝的核心原因是 `try()` 函数将使对错误的调试变得不够透明，
其本质在于将一个显式返回的错误值进行隐藏。例如，在调试过程中由于被调试函数被包裹在 `try()`
内，这种不包含错误分支的代码形式，对追踪错误本身是一个毁灭性的打击，为此用户不得不在调试时
引入错误分支，在调试结束后将错误分支消除，烦琐不堪。

我们从这前后两份提案中，可以看到 Go 团队将错误处理语义上的改进与
『如何减少 `if err != nil { ... }` 的出现』直接化了等号，这种纯粹写法风格上的问题，
与 Go 语言早期设计中显式错误值的设计相比，就显得相形见绌了。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
